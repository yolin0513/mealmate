// 匯出／匯入（npm run backuptest，puppeteer）。
//
// 守的事：round-trip（匯出 → 清空 → 匯入完全一致，中間有「確實清空過」的斷言）；
// 壞檔整份拒收、而且現有資料一列都沒少；判準有對照組（補上主鍵就放行）。

import { ok, eq, section, done, everyOf, detects } from './tap.mjs';
import { openApp, acceptWelcome, goto, titleIs } from './browserlib.mjs';

const { page, pageErrors, close } = await openApp();
try {
  await acceptWelcome(page);

  section('先種資料');
  const seeded = await page.evaluate(async () => {
    const store = await import('./js/store.js');
    const { newMember } = await import('./js/members.js');
    const prefs = await import('./js/prefs.js');
    await store.saveMember({ ...newMember(), name: '阿嬤', diet: 'lactoOvo', conditions: ['diabetes'] });
    await store.saveMember({ ...newMember(), name: '爸', conditions: ['kidney'], kidneyWatch: ['sodium'] });
    const r = await store.saveUserRecipe({
      id: store.newUserRecipeId(), name: '測試菜', role: 'side', servings: 2, time: 10, method: 'boil', vegMode: 'nativeVeg', texture: 'normal', season: [],
      ingredients: [{ food: '青江菜', label: '青江菜', grams: 200 }],
      steps: [{ text: '青江菜洗乾淨切段' }, { text: '滾水燙一分鐘撈起' }, { text: '瀝乾盛盤加點鹽' }],
    });
    await store.toggleFavorite('r-tomato-egg');
    await prefs.set('shoppingDays', [3, 6]);
    return { members: store.members().length, recipes: store.userRecipes().length, recipeErrors: r.errors, fav: store.favoriteIds() };
  });
  eq(seeded.members, 2, '兩位家人');
  eq(seeded.recipeErrors, [], '使用者食譜存進去了');
  eq(seeded.fav, ['r-tomato-egg'], '一筆收藏');

  section('匯出 → 清空 → 匯入');
  const result = await page.evaluate(async () => {
    const db = await import('./js/db.js');
    const { exportBundle, validateImport, applyImport, bundleCounts } = await import('./js/backup.js');
    const counts = async () => { const o = {}; for (const s of db.EXPORTABLE_STORES) o[s] = await db.count(s); return o; };
    const before = await counts();
    const bundle = await exportBundle();
    const json = JSON.stringify(bundle);
    for (const s of db.STORE_NAMES) await db.clear(s);
    const cleared = await counts();
    const parsed = JSON.parse(json);
    const errors = validateImport(parsed);
    await applyImport(parsed);
    const after = await counts();
    const membersAfter = await db.getAll('members');
    return { before, cleared, after, errors, bundleCounts: bundleCounts(parsed), membersBefore: bundle.stores.members, membersAfter, app: bundle.app, hasDate: /^\d{4}-\d{2}-\d{2}T/.test(bundle.exportedAt) };
  });
  eq(result.app, 'mealmate', '備份檔標 app');
  ok(result.hasDate, '有匯出時間');
  ok(result.before.members === 2 && result.before.userRecipes === 1 && result.before.favorites === 1 && result.before.settings >= 2, `（前提）匯出前：${JSON.stringify(result.before)}`);
  everyOf(Object.values(result.cleared), (n) => n === 0, '中間**確實清空過**（每個 store 都是 0）');
  eq(result.errors, [], '自己匯出的檔通過驗證');
  eq(result.after, result.before, '匯入後每個 store 的筆數跟匯出前一樣');
  eq(result.membersAfter.sort((a, b) => a.name.localeCompare(b.name)), result.membersBefore.sort((a, b) => a.name.localeCompare(b.name)), '家人資料逐欄一致');
  eq(result.bundleCounts.members, 2, 'bundleCounts 算得出家人 2');

  section('壞檔整份拒收，現有資料一列不少');
  const bad = await page.evaluate(async () => {
    const db = await import('./js/db.js');
    const { exportBundle, validateImport, applyImport } = await import('./js/backup.js');
    const counts = async () => { const o = {}; for (const s of db.EXPORTABLE_STORES) o[s] = await db.count(s); return o; };
    const good = await exportBundle();
    const clone = () => JSON.parse(JSON.stringify(good));
    const cases = {
      不是物件: 'hello',
      別的app: { ...clone(), app: 'stockdiary' },
      格式版本錯: { ...clone(), format: 99 },
      缺store: (() => { const b = clone(); delete b.stores.members; return b; })(),
      store不是陣列: (() => { const b = clone(); b.stores.favorites = { x: 1 }; return b; })(),
      不認得的store: (() => { const b = clone(); b.stores.secrets = []; return b; })(),
      一列缺主鍵: (() => { const b = clone(); b.stores.members.push({ name: '沒有 id 的人' }); return b; })(),
      一列不是物件: (() => { const b = clone(); b.stores.userRecipes.push('字串'); return b; })(),
    };
    const fixedKey = (() => { const b = clone(); b.stores.members.push({ id: 'm-fixed', name: '補上主鍵的人', ageGroup: 'adult', diet: 'omni', conditions: [], kidneyWatch: [], texture: 'normal', allergens: [], targets: {}, createdAt: '2026-01-01' }); return b; })();
    const results = {};
    const before = await counts();
    for (const [name, b] of Object.entries(cases)) {
      const errs = validateImport(b);
      let threw = false;
      try { await applyImport(b); } catch { threw = true; }
      results[name] = { errs: errs.length, threw, first: errs[0] ?? '' };
    }
    const after = await counts();
    const members = await db.getAll('members');
    return { results, before, after, fixedKeyErrors: validateImport(fixedKey), goodErrors: validateImport(good), members: members.map((m) => m.name).sort() };
  });
  const names = Object.keys(bad.results);
  ok(names.length >= 8, `（母體）${names.length} 種壞檔`);
  everyOf(names, (n) => bad.results[n].errs > 0, '每一種都被驗出錯誤');
  everyOf(names, (n) => bad.results[n].threw, '每一種 applyImport 都丟錯（不動資料）');
  for (const n of names) ok(bad.results[n].first.length > 0, `${n} → ${bad.results[n].first}`);
  eq(bad.after, bad.before, '八次壞檔之後，每個 store 的筆數一列都沒少');
  eq(bad.members, ['爸', '阿嬤'], '家人還是原本那兩位');
  detects((errs) => errs.length > 0, {
    shouldHit: [Object.values(bad.results).map((r) => new Array(r.errs).fill('e'))[0], ['x']],
    shouldMiss: [bad.fixedKeyErrors, bad.goodErrors],
  }, '（對照）缺主鍵那一列補上主鍵之後就放行；自己匯出的檔也放行 —— 擋住壞檔的是主鍵檢查，不是運氣');
  ok(bad.results['一列缺主鍵'].first.includes('主鍵'), `缺主鍵的錯誤訊息講出是主鍵：${bad.results['一列缺主鍵'].first}`);

  section('畫面上有備份卡片');
  await goto(page, '#/family');
  await titleIs(page, '家人');
  await page.waitForSelector('[data-card="backup"]');
  ok(await page.$('[data-card="backup"] [data-action="export"]') != null, '有匯出按鈕');
  ok(await page.$('[data-card="backup"] input[type="file"]') != null, '有匯入的檔案選擇');
  const backupText = await page.$eval('[data-card="backup"]', (el) => el.textContent);
  ok(backupText.includes('主畫面 App 與 Safari 不共用資料'), '講了 iPhone 主畫面 App 與 Safari 不共用資料');

  eq(pageErrors, [], '沒有未攔截的例外');
} finally {
  await close();
}
done('backuptest');

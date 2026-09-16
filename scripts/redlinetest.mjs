// 健康紅線總驗（npm run redlinetest，puppeteer）。
//
// 其他測試各自守住自己那一塊；這一支把**畫面上真正渲染出來的東西**整個掃一遍，
// 確認六條紅線在每一頁都成立（不是看程式碼，是看 DOM）：
//
//   1. 素版與葷版永遠不相加 —— 逐道菜比對兩欄，並確認畫面上沒有任何數字等於兩版的和
//   2. 營養數字一律標「估」，拿不到寫「未估算」，不寫 0
//   3. 有設慢性病留意項目的家人，那幾項一定看得見（不收在收合區裡）
//   4. 腎臟病沒勾子項 → 不自動限鉀（連帶：不顯示任何留意欄位）
//   5. 整個 App 的畫面文字沒有療效、治療、處方語氣
//   6. 醣類份數不顯示（沒有可引用的來源之前）

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ok, eq, section, done, everyOf, noneOf } from './tap.mjs';
import { openApp, acceptWelcome, goto, titleIs, textOf, sleep } from './browserlib.mjs';
import { indexFoods } from '../js/foods.js';
import { estimate } from '../js/nutrition.js';
import { fmtNutrient } from '../js/ui.js';
import { FORBIDDEN, forbiddenIn } from './copyrules.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const foods = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/foods.json'), 'utf8'));
const aliases = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/aliases.json'), 'utf8'));
const recipes = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/recipes.json'), 'utf8')).recipes;
const idx = indexFoods(foods, aliases);
const byId = new Map(recipes.map((r) => [r.id, r]));
const units = idx.units ?? {};

const { page, pageErrors, close } = await openApp();
try {
  await acceptWelcome(page);
  const seeded = await page.evaluate(async () => {
    const store = await import('./js/store.js');
    const prefs = await import('./js/prefs.js');
    const { newMember } = await import('./js/members.js');
    const { generateWeek, mondayOf, isoDate, weekKeyOf } = await import('./js/planner.js');
    await store.saveMember({ ...newMember(), name: '爸', diet: 'omni', conditions: ['hypertension'] });
    await store.saveMember({ ...newMember(), name: '阿嬤', ageGroup: 'senior', diet: 'lactoOvo', conditions: ['diabetes'] });
    await store.saveMember({ ...newMember(), name: '姊', diet: 'veganNoAllium' });
    await prefs.set('shoppingDays', [1, 4]);
    const mondayIso = mondayOf(isoDate(new Date()));
    const { plan, diagnostics } = generateWeek({
      recipes: store.allRecipes(), members: store.members(), idx: store.foodsIndex(), units: store.units(),
      rules: { noRepeatDays: prefs.get('noRepeatDays'), avoid: prefs.get('avoid') },
      favorites: [], history: [], mondayIso, seed: 'redline', shoppingDays: [1, 4], haveFoods: new Set(),
    });
    await store.savePlan({ ...plan, diagnostics });
    const byId2 = new Map(store.allRecipes().map((r) => [r.id, r]));
    const slot = plan.slots.find((s) => s.kind === 'cook' && s.items.some((it) => byId2.get(it.recipeId)?.vegMode === 'splittable'));
    return { weekKey: weekKeyOf(mondayIso), today: { d: slot.date, meal: slot.meal } };
  });
  ok(seeded.weekKey, `（前提）種了三位家人（高血壓、糖尿病、全素（不吃五辛））與一週菜單：${seeded.weekKey}`);

  // 這個家庭的留意欄位：高血壓 → 鈉；糖尿病 → 醣、糖、膳食纖維
  const WATCH = ['carb', 'sugar', 'fiber', 'sodium'];
  const EXPECT_FIELDS = ['kcal', 'protein', ...WATCH];

  section('紅線 1：素版與葷版永遠不相加');
  const splitDishes = recipes.filter((r) => r.vegMode === 'splittable').slice(0, 6);
  ok(splitDishes.length === 6, `（母體）抽 ${splitDishes.length} 道可分流的菜逐道比對`);
  const sumHits = [];
  for (const r of splitDishes) {
    await goto(page, `#/recipes/${r.id}`);
    await page.waitForSelector('[data-card="recipeNutrition"] [data-field="mainFields"] .nutri-value');
    for (const version of ['veg', 'meat']) {
      await page.evaluate((v) => {
        const chip = document.querySelector(`[data-chips="version"] .chip[data-value="${v}"]`);
        if (chip && !chip.classList.contains('on')) chip.click();
      }, version);
      await sleep(250);
      const shown = await page.$$eval('[data-card="recipeNutrition"] [data-field="mainFields"] .nutri-value',
        (els) => els.map((e) => ({ k: e.dataset.nutrient, t: e.textContent.trim().replace('＊', '') })));
      const est = estimate(r, idx, { version });
      const other = estimate(r, idx, { version: version === 'veg' ? 'meat' : 'veg' });
      for (const { k, t } of shown) {
        const want = fmtNutrient(est.perServing[k], units[k]);
        if (t !== want) sumHits.push(`${r.name} ${version} ${k}：畫面 ${t}、應為 ${want}`);
        if (est.perServing[k] > 0 && other.perServing[k] > 0) {
          const sumText = fmtNutrient(est.perServing[k] + other.perServing[k], units[k]);
          if (t === sumText) sumHits.push(`${r.name} ${version} ${k}：顯示的是兩版相加（${sumText}）`);
        }
      }
    }
  }
  eq(sumHits, [], '六道可分流的菜、兩個版本、每個欄位都等於自己那一軌，沒有一個是兩版相加');

  section('紅線 2：營養數字一律標「估」，拿不到寫「未估算」');
  const ROUTES = [['本週', '#/', '[data-card="weekHead"]'], ['今日煮', `#/today?d=${seeded.today.d}&meal=${seeded.today.meal}`, '[data-card="mealNutrition"]'],
    ['食譜清單', '#/recipes', '[data-list="recipes"] a.row'], ['食譜詳情', '#/recipes/r-cabbage-pork-stirfry', '[data-card="recipeNutrition"]'],
    ['買菜', '#/shopping', '[data-card="shopRange"]'], ['家人', '#/family', '[data-card="about"]']];
  const allValues = [];
  const pageTexts = [];
  for (const [name, hash, wait] of ROUTES) {
    await goto(page, '#/family/new');
    await sleep(200);
    await goto(page, hash);
    await page.waitForSelector(wait, { timeout: 60000 });
    await sleep(350);
    // 把收合區打開，藏起來的數字也要驗
    await page.evaluate(() => { for (const d of document.querySelectorAll('#view details')) d.open = true; });
    await sleep(250);
    // 取**數值**本身，不要連標籤一起取。食譜清單的欄位是
    // <span class="num"><span class="wl-k">膳食纖維 </span><span class="wl-v">未估算</span></span>，
    // 整個 .num 的 textContent 是「膳食纖維 未估算」—— 判準只好放寬成「中間有『估 』就算」，
    // 結果「未估算」（沒有「估」加空白）掉出去了。只看 .wl-v 的話判準就能收緊成兩種而已。
    const vals = await page.$$eval('#view .nutri-value, #view .watch-line .num',
      (els) => els.map((e) => (e.querySelector('.wl-v') ?? e).textContent.trim()));
    allValues.push(...vals.map((t) => ({ route: name, t })));
    pageTexts.push({ route: name, text: await textOf(page, '#view') });
  }
  ok(allValues.length >= 60, `（母體）六頁一共 ${allValues.length} 個營養數字`);
  everyOf(allValues, (v) => v.t.startsWith('估 ') || v.t === '未估算',
    '每一個數值不是「估 …」就是「未估算」（沒有第三種寫法，也沒有裸數字）');
  const unknown = allValues.filter((v) => v.t === '未估算').length;
  ok(unknown >= 1, `（母體）其中 ${unknown} 個是「未估算」—— 拿不到的欄位真的有被這樣寫出來，不是剛好全部都估得到`);
  eq(fmtNutrient(null, 'g'), '未估算', '拿不到的欄位走 fmtNutrient 會變成「未估算」');
  eq(fmtNutrient(0, 'g'), '估 0.0 g', '（對照）估出來真的是 0 的欄位寫成「估 0.0 g」—— 0 是估計結果，跟「沒資料」不是同一件事');
  {
    // 獨立把食譜詳情頁那道菜自己算一遍，比對畫面上「未估算」的個數。
    // 只看「畫面上有沒有 0」擋不住真正的錯法：把 null 當成 0 算出來的數字長得很合理。
    const detail = byId.get('r-blanched-okra');
    const est = estimate(detail, idx, { version: detail.vegMode === 'splittable' ? 'meat' : 'all' });
    const nulls = Object.entries(est.perServing).filter(([, v]) => v == null).map(([k]) => k);
    ok(nulls.length >= 1, `（前提）${detail.name} 真的有 ${nulls.length} 個欄位估不出來，這條才驗得到東西`);
    await goto(page, '#/recipes/r-blanched-okra');
    await page.waitForSelector('[data-card="recipeNutrition"]');
    await page.evaluate(() => { for (const d of document.querySelectorAll('#view details')) d.open = true; });
    await sleep(250);
    const shownNulls = await page.$$eval('#view [data-card="recipeNutrition"] .nutri-value',
      (els) => els.map((e) => e.textContent.trim()).filter((t) => t === '未估算').length);
    eq(shownNulls, nulls.length,
      `${detail.name}：獨立算出 ${nulls.length} 個拿不到的欄位（${nulls.join("、") || "無"}），畫面上「未估算」也是 ${shownNulls} 個 —— 沒有被偷偷算成 0`);
  }

  section('紅線 3：有設留意項目的家人，那幾項一定看得見');
  await goto(page, '#/');
  await titleIs(page, '本週菜單');
  await page.waitForSelector('[data-card="day"][data-day="0"] [data-field="dayEstimate"]');
  const dayFields = await page.$$eval('[data-card="day"][data-day="0"] .est-row', (els) => [...els[0].querySelectorAll('.nutri-value')].map((e) => e.dataset.nutrient));
  eq(dayFields.slice(0, 2), ['kcal', 'protein'], '每日估算前兩項固定是熱量與蛋白質');
  // 留意項目的**順序**跟著家人加入的順序走（familyWatchFields 沒有排序），所以這裡比集合不比順序
  eq([...dayFields].sort(), [...EXPECT_FIELDS].sort(), '再加上這個家庭的留意項目（醣、糖、膳食纖維、鈉），不多不少');
  const collapsed = await page.$eval('[data-card="day"][data-day="0"] [data-field="dayEstimate"]', (el) => el.open);
  eq(collapsed, false, '（前提）每日估算預設是收起來的');
  await goto(page, '#/recipes/r-cabbage-pork-stirfry');
  await page.waitForSelector('[data-card="recipeNutrition"] [data-field="mainFields"]');
  const inMain = await page.$$eval('[data-card="recipeNutrition"] [data-field="mainFields"] .nutri-value', (els) => els.map((e) => e.dataset.nutrient));
  eq([...inMain].sort(), [...EXPECT_FIELDS].sort(), '食譜詳情的主要區塊也是那幾項');
  eq(inMain, dayFields, '而且兩個畫面的欄位順序一致（同一支 displayFields 出來的）');
  const hiddenWatch = await page.evaluate(() => {
    const block = document.querySelector('[data-card="recipeNutrition"] [data-field="mainFields"]');
    return !!block.closest('details');
  });
  eq(hiddenWatch, false, '**留意項目沒有被收進展開區**（那正是這個 App 對慢性病使用者的用處）');

  section('紅線 4：腎臟病沒勾子項 → 不自動限鉀');
  const kidney = await page.evaluate(async () => {
    const store = await import('./js/store.js');
    const { newMember, watchFields, displayFields } = await import('./js/members.js');
    const m = { ...newMember(), id: 'm-kidney-test', name: '阿公', conditions: ['kidney'] };
    return { watch: watchFields(m), fields: displayFields([m]) };
  });
  eq(kidney.watch, [], '腎臟病沒勾子項 → watchFields() 一個欄位都不帶');
  eq(kidney.fields, ['kcal', 'protein'], '畫面也只剩熱量與蛋白質（沒有自動冒出鉀）');
  const kidney2 = await page.evaluate(async () => {
    const { newMember, watchFields, displayFields } = await import('./js/members.js');
    const m = { ...newMember(), id: 'm-kidney-2', name: '阿公', conditions: ['kidney'], kidneyWatch: ['sodium'] };
    return { watch: watchFields(m), fields: displayFields([m]) };
  });
  eq(kidney2.watch, ['sodium'], '（對照）勾了鈉就只帶鈉 —— 勾什麼顯示什麼');
  eq(kidney2.fields, ['kcal', 'protein', 'sodium'], '畫面跟著多一項鈉');

  section('紅線 5：畫面文字沒有療效、治療、處方語氣');
  ok(pageTexts.length === 6, `（母體）六頁的畫面文字共 ${pageTexts.reduce((n, p) => n + p.text.length, 0)} 字`);
  // 判準跟 copytest 用同一份（scripts/copyrules.mjs）：那份刻意不收「處方」「醫囑」，
  // 因為「不是營養處方」「不能取代醫囑」正是這個 App 必須講的話。
  const bad = pageTexts.flatMap((p) => forbiddenIn(p.text).map((w) => `${p.route}：${w}`));
  eq(bad, [], `六頁的畫面文字都沒有那 ${FORBIDDEN.length} 個禁用詞`);
  // 對照組：同一個判準，塞一句進去要抓得到
  eq(forbiddenIn('這樣吃有降血糖的療效'), ['治療', '療效', '降血糖'].filter((w) => '這樣吃有降血糖的療效'.includes(w)),
    '（對照）塞一句「有降血糖的療效」進去，同一個判準抓得到');
  ok(forbiddenIn('這樣吃有降血糖的療效').length >= 2, '（對照）而且抓到不只一個詞');
  eq(forbiddenIn('這個 App 不是營養處方，也不能取代醫囑'), ['取代醫囑'],
    '（對照）「不是營養處方」這種否定句不會被誤抓，只有「取代醫囑」被列進清單');

  section('紅線 6：醣類份數不顯示（沒有可引用來源之前）');
  const carbUnits = [];
  for (const p of pageTexts) for (const w of ['醣類份數', '份醣', '醣份']) if (p.text.includes(w)) carbUnits.push(`${p.route}：${w}`);
  eq(carbUnits, [], '六頁都沒有「醣類份數」這種換算');
  ok(pageTexts.some((p) => p.text.includes('碳水化合物（醣）')), '（對照）醣的克數本身有顯示 —— 上面那條不是因為整頁沒有醣');

  eq(pageErrors, [], '整段沒有未攔截的例外');
} finally {
  await close();
}
done('redlinetest');

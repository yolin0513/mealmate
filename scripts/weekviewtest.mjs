// 本週頁（npm run weekviewtest，puppeteer）：產生、素食成員都吃得了、為什麼選這道、換一道、鎖定後重新產生、外食、每日估計與目標對照。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ok, eq, section, done, everyOf, noneOf, note } from './tap.mjs';
import { openApp, acceptWelcome, goto, titleIs, textOf, sleep, clickEl, waitToastGone } from './browserlib.mjs';
import { versionFor } from '../js/members.js';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const recipes = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/recipes.json'), 'utf8')).recipes;
const byId = new Map(recipes.map((r) => [r.id, r]));

const mainIds = (page) => page.$$eval('.meal-item[data-pos="0"][data-role="main"]', (els) => els.map((e) => e.dataset.item));
const allItemIds = (page) => page.$$eval('.meal-item[data-item]', (els) => els.map((e) => e.dataset.item));

const { page, pageErrors, close } = await openApp();
try {
  await acceptWelcome(page);
  await page.evaluate(async () => {
    const store = await import('./js/store.js');
    const prefs = await import('./js/prefs.js');
    const { newMember } = await import('./js/members.js');
    await store.saveMember({ ...newMember(), name: '爸', diet: 'omni' });
    await store.saveMember({ ...newMember(), name: '阿嬤', ageGroup: 'senior', diet: 'lactoOvo', conditions: ['diabetes'], texture: 'soft', targets: { ...newMember().targets, carb: 180 } });
    await store.saveMember({ ...newMember(), name: '姊', diet: 'veganNoAllium' });
    await prefs.set('shoppingDays', [1, 4]);
  });

  section('產生本週');
  await goto(page, '#/family');
  await titleIs(page, '家人');
  await goto(page, '#/');
  await titleIs(page, '本週菜單');
  await page.waitForSelector('[data-card="weekEmpty"]');
  const emptyText = await textOf(page, '[data-card="weekEmpty"]');
  ok(emptyText.includes('爸（葷）') && emptyText.includes('姊（全素不含五辛）'), '空狀態列出家人');
  await clickEl(page, '[data-action="generate"]');
  await page.waitForSelector('[data-card="weekHead"]');
  eq(await page.$$eval('.meal-block', (els) => els.length), 21, '21 個餐格');
  const mains = await mainIds(page);
  eq(mains.length, 14, '14 個午晚餐都有主菜');
  const perMeal = await page.$$eval('.meal-block', (els) => els.map((e) => ({ meal: e.dataset.meal, n: e.querySelectorAll('.meal-item[data-item]').length })));
  const lunchN = perMeal.filter((x) => x.meal === 'lunch').map((x) => x.n);
  const dinnerN = perMeal.filter((x) => x.meal === 'dinner').map((x) => x.n);
  const bfN = perMeal.filter((x) => x.meal === 'breakfast').map((x) => x.n);
  eq([lunchN.length, dinnerN.length, bfN.length], [7, 7, 7], '（母體）七個午餐、七個晚餐、七個早餐');
  everyOf(lunchN, (n) => n >= 3 && n <= 5, `午餐 3–5 道（${lunchN.join('、')}）`);
  everyOf(dinnerN, (n) => n >= 4 && n <= 5, `晚餐 4–5 道（${dinnerN.join('、')}）`);
  everyOf(bfN, (n) => n === 1, '早餐一道');
  const meatyPerMeal = await page.$$eval('.meal-block', (els) => els.filter((e) => e.dataset.meal !== 'breakfast')
    .map((e) => [...e.querySelectorAll('.meal-item[data-item]')].map((x) => x.dataset.item)));
  ok(meatyPerMeal.length === 14, `（母體）${meatyPerMeal.length} 個午晚餐`);
  everyOf(meatyPerMeal, (ids) => ids.some((id) => byId.get(id) && byId.get(id).vegMode !== 'nativeVeg'), '每個午晚餐都有一道葷的（可分流的算 —— 素食成員吃素版）');
  const items = await allItemIds(page);
  ok(items.length >= 50, `（母體）${items.length} 道菜`);
  everyOf(items, (id) => byId.get(id) && versionFor(byId.get(id), 'lactoOvo') !== null && versionFor(byId.get(id), 'veganNoAllium') !== null, '每一道菜阿嬤（蛋奶素）與姊（全素不含五辛）都吃得了');
  const vegPerMeal = await page.$$eval('.meal-block', (els) => els.filter((e) => e.dataset.meal !== 'breakfast')
    .map((e) => [...e.querySelectorAll('.meal-item[data-item]')].map((x) => x.dataset.item)));
  everyOf(vegPerMeal, (ids) => ids.filter((id) => byId.get(id) && versionFor(byId.get(id), 'veganNoAllium') !== null).length >= 3,
    '每個午晚餐，全素不含五辛的姊至少吃得到 3 道（素食保障優先於「每餐有葷」）');
  noneOf(items, (id) => byId.get(id)?.vegMode === 'meatOnly', '這個家庭這一週沒有排到純葷的菜（靠可分流的菜就湊得出每餐有葷）');
  ok(items.some((id) => byId.get(id)?.vegMode === 'splittable'), '（對照）有可分流的菜，爸吃葷版');
  const pageText = await textOf(page, '#view');
  noneOf(['建議攝取', '應該吃', '治療', '療效'], (w) => pageText.includes(w), '整頁沒有處方式的字');
  ok(!/\b(null|undefined|NaN)\b/.test(pageText), '沒有漏出 null／undefined／NaN');
  const diag = await page.$('[data-card="diagnostics"]');
  if (diag) {
    const t = await textOf(page, '[data-card="diagnostics"]');
    ok(/因為符合條件的菜不夠|排不出菜|放寬/.test(t), `有勉強排的地方就講清楚：${t.slice(0, 80)}`);
  } else note('這週沒有勉強排的地方，所以沒有 diagnostics 卡片 —— 這是說明，不是斷言');

  section('為什麼選這道');
  await clickEl(page, '.meal-item[data-role="main"] .item-menu');
  await page.waitForSelector('.modal-card [data-field="reasons"] li');
  const reasons = await page.$$eval('.modal-card [data-field="reasons"] li', (els) => els.map((e) => e.textContent.trim()));
  ok(reasons.length >= 2, `${reasons.length} 條理由`);
  noneOf(reasons, (t) => /建議|應該|適合|療效|治療|控制|改善/.test(t), '理由沒有建議語氣或療效字眼');
  ok(reasons.some((t) => t.includes('姊（全素不含五辛）可吃')), '理由講出姊吃得了');
  ok(reasons.some((t) => /估 碳水化合物（醣）/.test(t)), '阿嬤留意醣 → 理由有醣的估計值與中位數比較');
  const firstMainBefore = mains[0];
  await clickEl(page, '.modal-card .modal-actions .btn:nth-of-type(2)');
  await waitToastGone(page).catch(() => {});
  await page.waitForFunction((prev) => document.querySelector('.meal-item[data-role="main"]')?.dataset.item !== prev, {}, firstMainBefore);
  const firstMainAfter = (await mainIds(page))[0];
  ok(firstMainAfter !== firstMainBefore && byId.get(firstMainAfter)?.role === 'main', `換一道：${byId.get(firstMainBefore)?.name} → ${byId.get(firstMainAfter)?.name}`);

  section('鎖定後重新產生');
  await clickEl(page, '.meal-item[data-role="main"] .item-menu');
  await page.waitForSelector('.modal-card .modal-actions');
  await page.evaluate(() => { [...document.querySelectorAll('.modal-card .modal-actions .btn')].find((b) => b.textContent.includes('鎖定這道'))?.click(); });
  await page.waitForSelector('.meal-item[data-role="main"] .lock');
  const lockedId = (await mainIds(page))[0];
  const beforeAll = await mainIds(page);
  await clickEl(page, '[data-action="regenerate"]');
  await page.waitForFunction(() => !document.querySelector('[data-action="regenerate"]')?.disabled);
  await sleep(300);
  const afterAll = await mainIds(page);
  eq(afterAll[0], lockedId, '鎖住的主菜重新產生後還是同一道');
  ok(await page.$('.meal-item[data-role="main"] .lock') != null, '鎖頭還在');
  ok(afterAll.some((id, i) => id !== beforeAll[i]), '（對照）沒鎖的主菜有變（換了 seed）');
  eq(afterAll.length, 14, '仍然 14 個主菜');

  section('外食');
  await clickEl(page, '.meal-block[data-meal="lunch"] [data-action="kind"]');
  await page.waitForSelector('.modal-card .modal-actions');
  await page.evaluate(() => { [...document.querySelectorAll('.modal-card .modal-actions .btn')].find((b) => b.textContent === '外食')?.click(); });
  await page.waitForSelector('.meal-block[data-meal="lunch"][data-kind="eatOut"]');
  const eatOut = await page.$eval('.meal-block[data-meal="lunch"][data-kind="eatOut"]', (el) => ({ items: el.querySelectorAll('.meal-item').length, text: el.textContent }));
  eq(eatOut.items, 0, '外食格沒有菜');
  ok(eatOut.text.includes('外食'), '寫著外食');
  eq((await mainIds(page)).length, 13, '主菜剩 13 個');

  section('「僅葷食成員」的加菜怎麼顯示');
  // 加菜是「排不到可分流主菜時」才會出現的少數情況，真實池子常常一整週都碰不到。
  // 這裡直接把一道加菜寫進計畫，驗的是**畫面**有沒有照規矩標示（規劃器那邊由 plannertest 驗）。
  const extraDishId = recipes.find((r) => r.role === 'main' && r.vegMode === 'meatOnly').id;
  await page.evaluate(async (id) => {
    const store = await import('./js/store.js');
    const { mondayOf, weekKeyOf, isoDate } = await import('./js/planner.js');
    const plan = await store.getPlan(weekKeyOf(mondayOf(isoDate(new Date()))));
    const slot = plan.slots.find((s) => s.meal === 'dinner' && s.kind === 'cook');
    const target = slot.items.filter((it) => it.role === 'side').pop();
    target.recipeId = id;
    target.role = 'main';
    target.extraMeat = true;
    target.reasons = ['這一餐的主菜是素的，這道是給吃葷的人的加菜'];
    await store.savePlan(plan);
  }, extraDishId);
  await goto(page, '#/family');
  await titleIs(page, '家人');
  await goto(page, '#/');
  await titleIs(page, '本週菜單');
  await page.waitForSelector('.meal-item[data-extra="meat"]');
  const extraEl = await page.$$eval('.meal-item[data-extra="meat"]', (els) => els.map((e) => ({ id: e.dataset.item, role: e.dataset.role, text: e.textContent.replace(/\s+/g, ' ') })));
  eq(extraEl.length, 1, '（母體）畫面上有一道加菜');
  ok(extraEl[0].text.includes('僅葷食成員'), `加菜標明「僅葷食成員」：${extraEl[0].text}`);
  ok(extraEl[0].text.includes('加菜'), '而且角色標籤寫「加菜」，不是「主菜」');
  eq(extraEl[0].id, extraDishId, '就是那道純葷的菜');
  await clickEl(page, '.meal-item[data-extra="meat"] .item-menu');
  await page.waitForSelector('.modal-card');
  const extraModal = await textOf(page, '.modal-card');
  ok(extraModal.includes('素食成員吃不了'), `選單裡講明素食成員吃不了：${extraModal.slice(0, 60)}`);
  ok(extraModal.includes('其他幾道他們吃得到'), '也講了同一餐他們吃得到什麼');
  await page.keyboard.press('Escape');
  await sleep(200);

  section('每日估計與目標對照');
  await page.waitForSelector('[data-card="day"][data-day="0"] [data-field="dayEstimate"]');
  await page.$eval('[data-card="day"][data-day="0"] [data-field="dayEstimate"] summary', (el) => el.click());
  await sleep(150);
  const estRows = await page.$$eval('[data-card="day"][data-day="0"] .est-row', (els) => els.map((e) => ({ member: e.dataset.member, values: [...e.querySelectorAll('.nutri-value')].map((v) => v.textContent.trim()), targets: [...e.querySelectorAll('[data-target]')].map((t) => t.textContent) })));
  eq(estRows.map((r) => r.member), ['爸', '阿嬤', '姊'], '三位家人各一列');
  everyOf(estRows.flatMap((r) => r.values), (t) => /^估 /.test(t) || t.startsWith('未估算'), '每個數字帶「估」或「未估算」');
  const grandma = estRows.find((r) => r.member === '阿嬤');
  eq(grandma.targets.length, 1, '阿嬤有填醣的目標 → 一條對照');
  ok(grandma.targets[0].includes('醫師或營養師給的每日目標 180') && /今日估 [\d.]+/.test(grandma.targets[0]) && /\d+%/.test(grandma.targets[0]), `對照條講事實：${grandma.targets[0]}`);
  everyOf(estRows.filter((r) => r.member !== '阿嬤'), (r) => r.targets.length === 0, '沒填目標的家人沒有對照條（App 不替人設目標）');

  section('營養標示：預設熱量＋蛋白質，有留意項目的加顯');
  const fieldsOf = () => page.$$eval('[data-card="day"][data-day="0"] .est-row', (els) => [...els[0].querySelectorAll('.nutri-value')].map((e) => e.dataset.nutrient));
  const withWatch = await fieldsOf();
  eq(withWatch.slice(0, 2), ['kcal', 'protein'], '前兩項固定是熱量與蛋白質');
  eq(withWatch, ['kcal', 'protein', 'carb', 'sugar', 'fiber'], '阿嬤有糖尿病 → 醣、糖、膳食纖維直接顯示在畫面上（不收進展開區）');
  // 把留意項目拿掉：預設就只剩兩項
  await page.evaluate(async () => {
    const store = await import('./js/store.js');
    for (const mm of store.members()) await store.saveMember({ ...mm, conditions: [], kidneyWatch: [] });
  });
  await goto(page, '#/family');
  await titleIs(page, '家人');
  await goto(page, '#/');
  await titleIs(page, '本週菜單');
  await page.waitForSelector('[data-card="day"][data-day="0"] [data-field="dayEstimate"]');
  await page.$eval('[data-card="day"][data-day="0"] [data-field="dayEstimate"] summary', (el) => el.click());
  await sleep(200);
  eq(await fieldsOf(), ['kcal', 'protein'], '沒有人設留意項目 → 只剩熱量與蛋白質兩項');
  const dayText = await textOf(page, '[data-card="day"][data-day="0"]');
  ok(dayText.includes('阿嬤') && dayText.includes('（蛋奶素）'), '列出飲食型態');
  noneOf([dayText], (t) => /建議攝取|應該吃/.test(t), '每日估計沒有處方式的字');

  section('舊版存下來的計畫（沒有位置欄位）也要能用');
  // v0.6.0 以前一餐一個角色只有一道菜，存進 IndexedDB 的 item 沒有 pos。
  // 使用者升級之後那一週的計畫還在，本週頁要照樣畫得出來、換菜也要換到對的那一道。
  const oldShape = await page.evaluate(async () => {
    const db = await import('./js/db.js');
    const store = await import('./js/store.js');
    const { mondayOf, weekKeyOf, isoDate } = await import('./js/planner.js');
    const weekKey = weekKeyOf(mondayOf(isoDate(new Date())));
    const plan = await store.getPlan(weekKey);
    // 把它改回舊格式：拿掉每個 pos，順序也打亂成「後面的角色排前面」
    const stripped = {
      ...plan,
      slots: plan.slots.map((s) => ({ ...s, items: [...s.items].reverse().map(({ pos, extraMeat, ...rest }) => rest) })),
    };
    await db.put('plans', stripped);
    const readBack = await store.getPlan(weekKey);
    const lunch = readBack.slots.find((s) => s.meal === 'lunch' && s.kind === 'cook');
    return { weekKey, positions: lunch.items.map((it) => it.pos), roles: lunch.items.map((it) => it.role) };
  });
  everyOf(oldShape.positions, (p) => Number.isInteger(p), `讀出來時補上了位置：${oldShape.positions.join('、')}`);
  eq(oldShape.roles[0], 'main', '而且照位置排好，主菜回到第一個');
  await goto(page, '#/family');
  await titleIs(page, '家人');
  await goto(page, '#/');
  await titleIs(page, '本週菜單');
  await page.waitForSelector('[data-card="weekHead"]');
  const afterMigrate = await page.$$eval('.meal-item[data-item]', (els) => els.length);
  ok(afterMigrate >= 60, `舊格式的計畫照樣畫得出 ${afterMigrate} 道菜`);
  const lunchItems = await page.$$eval('.meal-block[data-meal="lunch"] .meal-item[data-item]', (els) => els.map((e) => `${e.dataset.pos}:${e.dataset.role}`));
  ok(lunchItems.length >= 3, `（母體）七個午餐一共畫出 ${lunchItems.length} 道`);
  everyOf(lunchItems, (t) => /^\d+:/.test(t), '每一道都有位置編號，畫面找得到它們');

  section('下週與重新載入');
  await page.reload({ waitUntil: 'networkidle0' });
  await titleIs(page, '本週菜單');
  await page.waitForSelector('[data-card="weekHead"]');
  eq((await mainIds(page)).length, 13, '重新載入後計畫還在（含外食那一格）');
  await clickEl(page, '[data-chips="week"] .chip[data-value="next"]');
  await page.waitForSelector('[data-card="weekEmpty"]');
  ok((await textOf(page, '[data-card="weekEmpty"]')).includes('產生下週菜單'), '下週還沒有計畫，按鈕寫「產生下週菜單」');


  section('診斷卡：道數是道數，原因是實際原因，保存期限要接到買菜日設定');
  // 舊版兩個毛病：(1) 拿 diagnostics.relaxed.length 當道數，但那時一道菜每開一個旗標推一筆，
  // 12 道會被講成 37 道；(2) 文案寫死「時間上限或同餐烹法」，真正的主因（保存期限）從來沒被講出來。
  {
    // 一週只買一次菜 → 保存期限吃緊，正是會出現放寬的情境
    await page.evaluate(async () => {
      const prefs = await import('./js/prefs.js');
      await prefs.set('shoppingDays', [3]);
    });
    await goto(page, '#/');
    await titleIs(page, '本週菜單');
    await clickEl(page, '[data-action="regenerate"]');
    await page.waitForFunction(() => !document.querySelector('[data-action="regenerate"]')?.disabled);
    await waitToastGone(page);

    const diag = await page.evaluate(async () => {
      const store = await import('./js/store.js');
      const { weekKeyOf, mondayOf, isoDate } = await import('./js/planner.js');
      const plan = await store.getPlan(weekKeyOf(mondayOf(isoDate(new Date()))));
      return plan?.diagnostics?.relaxed ?? [];
    });
    ok(diag.length >= 1, `（前提）一週買一次菜時這週有 ${diag.length} 道被放寬`);
    const dishKeys = diag.map((r) => `${r.date}|${r.meal}|${r.pos}`);
    eq(dishKeys.length, new Set(dishKeys).size, '存進計畫的 relaxed 是一道菜一筆');

    const line = await textOf(page, '[data-card="diagnostics"] [data-field="relaxed"]');
    ok(line.startsWith(`${diag.length} 道放寬了限制`), `卡片講的道數＝實際道數 ${diag.length}：「${line}」`);
    const shown = [...line.matchAll(/(\d+) 道/g)].map((m) => Number(m[1]));
    eq(shown[0], diag.length, '開頭那個數字就是道數');
    ok(shown.slice(1).reduce((a, b) => a + b, 0) >= diag.length, '後面分項的加總不少於道數（一道菜可能踩到兩條）');

    // 實際原因要被講出來，沒發生的原因不可以出現
    const kinds = new Set(diag.flatMap((r) => r.constraints));
    const LABEL = { relaxShelf: '食材放不到那一天', relaxTime: '超過這一餐的時間上限', relaxMethod: '同一餐有兩道同樣烹法', relaxDay: '同一天重複同一道' };
    everyOf([...kinds], (k) => line.includes(LABEL[k]), `這週實際踩到的 ${kinds.size} 種原因（${[...kinds].join('、')}）都寫在卡片上`);
    const notHit = Object.keys(LABEL).filter((k) => !kinds.has(k));
    ok(notHit.length >= 1, `（母體）這週沒踩到的原因有 ${notHit.length} 種`);
    noneOf(notHit, (k) => line.includes(LABEL[k]), '沒踩到的原因一個都沒出現在卡片上');

    // 保存期限 → 直接接到「多勾一個買菜日」
    const shelfN = diag.filter((r) => r.constraints.includes('relaxShelf')).length;
    ok(shelfN >= 1, `（前提）其中 ${shelfN} 道是保存期限`);
    const hint = await textOf(page, '[data-card="diagnostics"] [data-field="shelfHint"]');
    ok(hint.includes(`${shelfN} 道`), `提示講的道數也是實際的 ${shelfN} 道`);
    ok(hint.includes('星期三'), '提示點名使用者自己設的買菜日（星期三）');
    const href = await page.$eval('[data-field="shelfHint"] a', (a) => a.getAttribute('href'));
    eq(href, '#/family', '提示裡的連結直接到家人分頁（就是改買菜日的地方）');

    // 買菜日加到兩天 → 保存期限的壓力消失，提示也跟著不見
    await page.evaluate(async () => {
      const prefs = await import('./js/prefs.js');
      await prefs.set('shoppingDays', [3, 6]);
    });
    await goto(page, '#/');
    await clickEl(page, '[data-action="regenerate"]');
    await page.waitForFunction(() => !document.querySelector('[data-action="regenerate"]')?.disabled);
    await waitToastGone(page);
    const after = await page.evaluate(async () => {
      const store = await import('./js/store.js');
      const { weekKeyOf, mondayOf, isoDate } = await import('./js/planner.js');
      const plan = await store.getPlan(weekKeyOf(mondayOf(isoDate(new Date()))));
      return (plan?.diagnostics?.relaxed ?? []).filter((r) => r.constraints.includes('relaxShelf')).length;
    });
    ok(after < shelfN, `（對照）多勾一個買菜日之後，卡在保存期限的從 ${shelfN} 道降到 ${after} 道 —— 提示講的是真的`);
    eq((await page.$$('[data-field="shelfHint"]')).length, 0, '沒有保存期限的壓力時，提示不出現');
  }


  eq(pageErrors, [], '沒有未攔截的例外');
} finally {
  await close();
}
done('weekviewtest');

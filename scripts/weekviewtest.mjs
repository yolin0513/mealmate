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
  ok(emptyText.includes('爸（葷）') && emptyText.includes('姊（全素）'), '空狀態列出家人');
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
  // 2026-09-16 SPEC_排菜葷素比例：混合家庭每個午晚餐會多一道只有吃葷的人吃的純葷加菜。
  // 這裡驗的改成「除了加菜以外」每一道素食成員都吃得了。
  const extraIds = await page.$$eval('.meal-item[data-extra="meat"]', (els) => els.map((e) => e.dataset.item));
  const plainIds = items.filter((id) => !extraIds.includes(id));
  ok(plainIds.length >= 40, `（母體）不含加菜的 ${plainIds.length} 道`);
  everyOf(plainIds, (id) => byId.get(id) && versionFor(byId.get(id), 'lactoOvo') !== null && versionFor(byId.get(id), 'veganNoAllium') !== null, '除了加菜，每一道菜阿嬤（蛋奶素）與姊（全素（不吃五辛））都吃得了');
  const vegPerMeal = await page.$$eval('.meal-block', (els) => els.filter((e) => e.dataset.meal !== 'breakfast')
    .map((e) => [...e.querySelectorAll('.meal-item[data-item]')].map((x) => x.dataset.item)));
  everyOf(vegPerMeal, (ids) => ids.filter((id) => byId.get(id) && versionFor(byId.get(id), 'veganNoAllium') !== null).length >= 3,
    '每個午晚餐，全素（不吃五辛）的姊至少吃得到 3 道（素食保障優先於「每餐有葷」）');
  ok(extraIds.length >= 10, `（母體）這一週有 ${extraIds.length} 道加菜`);
  everyOf(extraIds, (id) => byId.get(id)?.vegMode === 'meatOnly', '標了加菜的都是純葷的菜');
  noneOf(plainIds, (id) => byId.get(id)?.vegMode === 'meatOnly', '沒標加菜的那些，一道純葷的都沒有（純葷只會以加菜的身分出現）');
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
  ok(reasons.some((t) => t.includes('姊（全素）可吃')), '理由講出姊吃得了');
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
  // 2026-09-16 起混合家庭每餐本來就有加菜，所以不再是「剛好一道」；驗的是剛剛塞的那一道有畫出來。
  ok(extraEl.length >= 1, `（母體）畫面上有 ${extraEl.length} 道加菜`);
  ok(extraEl.some((x) => x.id === extraDishId), '剛剛塞進計畫的那一道加菜有畫出來');
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
  const readEst = () => page.$$eval('[data-card="day"][data-day="0"] .est-row', (els) => els.map((e) => ({ members: e.dataset.members, diets: e.dataset.diets, values: [...e.querySelectorAll('.nutri-value')].map((v) => v.textContent.trim()), targets: [...e.querySelectorAll('[data-target]')].map((t) => t.textContent) })));
  const estRows = await readEst();
  const whoIn = (r) => r.members.split('、');
  eq(estRows.flatMap(whoIn).sort(), ['姊', '爸', '阿嬤'].sort(), '三位家人都被歸進某一組，沒有人不見');
  ok(estRows.length >= 1 && estRows.length <= 3, `三位家人併成 ${estRows.length} 組（數字一樣的才併）`);
  const sigs = estRows.map((r) => r.values.join('|'));
  eq(new Set(sigs).size, sigs.length, '不同組的數字一定不一樣 —— 一樣的話早就併在同一組了');
  everyOf(estRows, (r) => r.diets && r.diets.length > 0, '每一組都標出飲食型態');
  everyOf(estRows.flatMap((r) => r.values), (t) => /^估 /.test(t) || t.startsWith('未估算'), '每個數字帶「估」或「未估算」');
  const grandma = estRows.find((r) => whoIn(r).includes('阿嬤'));
  eq(grandma.targets.length, 1, '阿嬤有填醣的目標 → 一條對照');
  ok(grandma.targets[0].includes('醫師或營養師給的每日目標 180') && /今日估 [\d.]+/.test(grandma.targets[0]) && /\d+%/.test(grandma.targets[0]), `對照條講事實：${grandma.targets[0]}`);
  everyOf(estRows.flatMap((r) => r.targets), (t) => t.startsWith('阿嬤：'), '只有填了目標的阿嬤有對照條，而且標明是誰的目標（App 不替人設目標）');
  eq(estRows.filter((r) => r.targets.length).length, 1, `只有一組帶對照條（阿嬤在的那一組）`);

  // 2026-09-16 使用者回報：吃葷的家人每人各列一份、數字一模一樣，重複又佔版面 → 數字一樣的併成一組。
  await page.evaluate(async () => {
    const store = await import('./js/store.js');
    const { newMember } = await import('./js/members.js');
    await store.saveMember({ ...newMember(), name: '弟', diet: 'omni' });
  });
  await goto(page, '#/family');
  await titleIs(page, '家人');
  await goto(page, '#/');
  await titleIs(page, '本週菜單');
  await page.waitForSelector('[data-card="day"][data-day="0"] [data-field="dayEstimate"]');
  await page.$eval('[data-card="day"][data-day="0"] [data-field="dayEstimate"] summary', (el) => el.click());
  await sleep(200);
  const merged = await readEst();
  const dadNow = merged.find((r) => r.members.split('、').includes('爸'));
  ok(dadNow.members.split('、').includes('弟'), `再加一位吃葷的「弟」→ 跟「爸」併成同一組（${dadNow.members}），那份數字只列一次`);
  eq(merged.length, estRows.length, '組數沒有變多 —— 弟沒有自己多佔一張卡');
  eq(dadNow.diets, 'omni', '那一組標出飲食型態是葷');
  eq(dadNow.values, estRows.find((r) => whoIn(r).includes('爸')).values, '數字跟原本「爸」那一組一模一樣 —— 共用同一份估算，不是相加');
  const dayTextGrouped = await textOf(page, '[data-card="day"][data-day="0"]');
  ok(dayTextGrouped.includes('爸、弟'), '卡片上寫出這一組包含哪些成員');
  await page.evaluate(async () => {
    const store = await import('./js/store.js');
    const bro = store.members().find((m) => m.name === '弟');
    if (bro) await store.deleteMember(bro.id);
  });
  await goto(page, '#/family');
  await titleIs(page, '家人');
  await goto(page, '#/');
  await titleIs(page, '本週菜單');

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
  ok(dayText.includes('阿嬤') && dayText.includes('蛋奶素'), '列出飲食型態與成員');
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
    // 固定 seed 自己種一份計畫，不按「重新產生」——那顆按鈕走 newSeed: true，
    // seed 取自 Date.now()，每次跑驗到的是不同的菜單（慣例 18）。
    // 另外把平日時間上限壓到 15 分鐘（25 分鐘時 10 月那幾週會湊不出同時踩兩條的菜，前置斷言就紅了；15 分鐘在一整年 52 週裡最少也有 5 道）：一週只買一次菜已經讓保存期限咬得到，
    // 再讓時間也咬得到，就一定會有菜同時踩到兩條 —— 「一道菜一筆」那條才分得出對錯。
    const diag = await page.evaluate(async () => {
      const store = await import('./js/store.js');
      const prefs = await import('./js/prefs.js');
      const { generateWeek, mondayOf, isoDate } = await import('./js/planner.js');
      await prefs.set('shoppingDays', [3]);
      const mondayIso = mondayOf(isoDate(new Date()));
      const { plan, diagnostics } = generateWeek({
        recipes: store.allRecipes(), members: store.members(), idx: store.foodsIndex(), units: store.units(),
        rules: { noRepeatDays: prefs.get('noRepeatDays'), avoid: prefs.get('avoid'),
          timeCaps: { weekday: { breakfast: 10, lunch: 15, dinner: 15 }, weekend: { breakfast: 15, lunch: 20, dinner: 20 } } },
        favorites: [], history: [], mondayIso, seed: 'diagfix', shoppingDays: [3],
      });
      await store.savePlan({ ...plan, diagnostics });
      return diagnostics.relaxed;
    });
    await goto(page, '#/');
    await titleIs(page, '本週菜單');
    await page.waitForSelector('[data-card="diagnostics"]');
    ok(diag.length >= 1, `（前提）這份 fixture 有 ${diag.length} 道被放寬`);
    const multi = diag.filter((r) => r.constraints.length >= 2);
    ok(multi.length >= 1,
      `（前提）其中 ${multi.length} 道**同時**踩到兩條以上（例：${multi[0]?.constraints.join('＋')}）——` +
      '沒有這種菜的話，下面「一道菜一筆」那條分不出對錯（改成一個旗標一筆也會得到一樣的筆數）');
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
    const after = await page.evaluate(async () => {
      const store = await import('./js/store.js');
      const prefs = await import('./js/prefs.js');
      const { generateWeek, mondayOf, isoDate } = await import('./js/planner.js');
      await prefs.set('shoppingDays', [3, 6]);
      const mondayIso = mondayOf(isoDate(new Date()));
      // 除了買菜日，其他條件跟上面那份一模一樣（同 seed、同時間上限），差異才歸得到買菜日
      const { plan, diagnostics } = generateWeek({
        recipes: store.allRecipes(), members: store.members(), idx: store.foodsIndex(), units: store.units(),
        rules: { noRepeatDays: prefs.get('noRepeatDays'), avoid: prefs.get('avoid'),
          timeCaps: { weekday: { breakfast: 10, lunch: 15, dinner: 15 }, weekend: { breakfast: 15, lunch: 20, dinner: 20 } } },
        favorites: [], history: [], mondayIso, seed: 'diagfix', shoppingDays: [3, 6],
      });
      await store.savePlan({ ...plan, diagnostics });
      return diagnostics.relaxed.filter((r) => r.constraints.includes('relaxShelf')).length;
    });
    // 先離開再回來：hash 沒變的話 router 不會重畫，畫面還會是上一份計畫的卡片
    await goto(page, '#/family');
    await titleIs(page, '家人');
    await goto(page, '#/');
    await page.waitForSelector('[data-card="weekHead"]');
    ok(after < shelfN, `（對照）多勾一個買菜日之後，卡在保存期限的從 ${shelfN} 道降到 ${after} 道 —— 提示講的是真的`);
    eq((await page.$$('[data-field="shelfHint"]')).length, 0, '沒有保存期限的壓力時，提示不出現');
  }



  section('每一天可以摺疊：真的移出版面，而且記得住');
  {
    // 先回到一個有計畫的狀態
    await goto(page, '#/family');
    await titleIs(page, '家人');
    await goto(page, '#/');
    await page.waitForSelector('[data-card="day"][data-day="0"]');

    const dayState = (d) => page.evaluate((day) => {
      const card = document.querySelector(`[data-card="day"][data-day="${day}"]`);
      const body = card?.querySelector('[data-field="dayBody"]');
      const btn = card?.querySelector('[data-action="toggleDay"]');
      const sum = card?.querySelector('[data-field="daySummary"]');
      const r = body?.getBoundingClientRect();
      return {
        open: card?.dataset.open,
        aria: btn?.getAttribute('aria-expanded'),
        ariaControls: btn?.getAttribute('aria-controls'),
        bodyId: body?.id,
        bodyHidden: body?.hidden,
        // hidden 要真的不佔版面：CSS 有 [hidden]{display:none!important}
        bodyH: r ? Math.round(r.height) : null,
        mealsVisible: [...(body?.querySelectorAll('.meal-block') ?? [])].filter((e) => e.getBoundingClientRect().height > 0).length,
        summaryHidden: sum?.hidden,
        summaryText: sum?.textContent?.trim() ?? '',
        btnH: btn ? Math.round(btn.getBoundingClientRect().height) : null,
      };
    }, d);

    const before = await dayState(0);
    eq(before.open, 'true', '一開始週一是展開的');
    eq(before.aria, 'true', 'aria-expanded 也是 true');
    ok(before.mealsVisible === 3, `展開時三餐都看得到（${before.mealsVisible} 個餐格）`);
    eq(before.summaryHidden, true, '展開時不顯示摘要（內容自己就看得到了）');
    eq(before.ariaControls, before.bodyId, 'aria-controls 指到它控制的那一塊（id 對得上）');
    ok(before.btnH >= 44, `整條日期列就是開關，高度 ${before.btnH}px（≥ 44）`);

    await clickEl(page, '[data-card="day"][data-day="0"] [data-action="toggleDay"]');
    await sleep(150);
    const after = await dayState(0);
    eq(after.open, 'false', '點一下收起來');
    eq(after.aria, 'false', 'aria-expanded 跟著變 false（螢幕閱讀器知道它收起來了）');
    eq(after.bodyHidden, true, '內容設成 hidden —— 不是只改外觀，讀螢幕的人也讀不到');
    eq(after.bodyH, 0, '而且真的不佔版面（高度 0）');
    eq(after.mealsVisible, 0, '三餐一個都量不到');
    eq(after.summaryHidden, false, '改成顯示一行摘要，收起來的日子還看得出有沒有事');
    ok(/自己煮|外食|不煮|還沒排/.test(after.summaryText), `摘要講得出這天的狀況：「${after.summaryText}」`);

    // 別的日子不受影響
    const other = await dayState(1);
    eq(other.open, 'true', '只收起被點的那一天，週二還是開的');

    // 記得住：重新載入之後還是收的
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-card="day"][data-day="0"]');
    const reloaded = await dayState(0);
    eq(reloaded.open, 'false', '重新載入後週一還是收起來的');
    eq(reloaded.bodyHidden, true, '而且內容仍然是 hidden');
    eq((await dayState(1)).open, 'true', '（對照）週二仍然是開的 —— 不是把整週都收了');

    // 再點一次打開
    await clickEl(page, '[data-card="day"][data-day="0"] [data-action="toggleDay"]');
    await sleep(150);
    const reopened = await dayState(0);
    eq(reopened.open, 'true', '再點一次打開');
    eq(reopened.bodyHidden, false, '內容回來了');
    ok(reopened.mealsVisible === 3, '三餐又看得到');

    // 存進 prefs 的是「這一週」的狀態，不是全域
    await clickEl(page, '[data-card="day"][data-day="2"] [data-action="toggleDay"]');
    await sleep(200);
    const stored = await page.evaluate(async () => {
      const prefs = await import('./js/prefs.js');
      const { weekKeyOf, mondayOf, isoDate, addDays } = await import('./js/planner.js');
      const thisWeek = weekKeyOf(mondayOf(isoDate(new Date())));
      const nextWeek = weekKeyOf(addDays(mondayOf(isoDate(new Date())), 7));
      return { all: prefs.get('collapsedDays'), thisWeek: prefs.collapsedDaysFor(thisWeek), nextWeek: prefs.collapsedDaysFor(nextWeek) };
    });
    eq(stored.thisWeek, [2], '這一週記著第 2 天是收的');
    eq(stored.nextWeek, [], '下一週不受影響（摺疊是這一週的事，不是「每個星期三都收起來」）');
    ok(Object.keys(stored.all).length <= 4, `只留最近幾週（現在存了 ${Object.keys(stored.all).length} 週）`);
  }


  section('一週平衡：本週頁講出這週排了幾道比較豐盛的主菜，並帶那句說明');
  {
    // 使用者 2026-09-14 確認：平衡要誠實告訴使用者，不是偷偷調；那句「不是營養處方」要保留、不准有療效字眼。
    const readBalance = () => page.evaluate(async () => {
      const store = await import('./js/store.js');
      const prefs = await import('./js/prefs.js');
      const { weekBalance, weekKeyOf, mondayOf, isoDate } = await import('./js/planner.js');
      const plan = await store.getPlan(weekKeyOf(mondayOf(isoDate(new Date()))));
      const b = weekBalance({ plan, recipes: store.allRecipes(), members: store.members(), idx: store.foodsIndex(), units: store.units(), rules: { heartyLevel: prefs.get('heartyLevel') } });
      return { n: b.hearty.length, load: b.load, over: b.over, budget: b.budget, names: b.hearty.map((x) => x.name.split('／')[0].replace(/（.*?）/g, '')) };
    });
    await goto(page, '#/family');
    await titleIs(page, '家人');
    await goto(page, '#/');
    await page.waitForSelector('[data-card="balance"] [data-field="balanceText"]');
    const t1 = await textOf(page, '[data-card="balance"] [data-field="balanceText"]');
    ok(t1.endsWith('這是一般飲食常識的安排，不是營養處方。'), `一週平衡那一段最後帶著那句說明：「${t1}」`);
    noneOf(['健康', '降', '控制', '療效', '治療', '改善'], (w) => t1.includes(w), '沒有療效字眼（健康／降／控制…）');
    const b1 = await readBalance();
    if (b1.n) ok(t1.includes(`這週有 ${b1.n} 餐`) && b1.names.slice(0, 4).every((nm) => t1.includes(nm)), `講的道數與菜名跟排菜器算的一樣（${b1.n} 道：${b1.names.join('、')}）`);
    else ok(t1.includes('沒有排到比較豐盛的主菜'), '這週沒有豐盛的主菜 → 照實講');

    // 家人頁選「少」→ 重新產生（先把前面測試鎖住的菜解鎖，免得鎖住的菜佔掉配額）→ 最多 2 道
    await page.evaluate(async () => {
      const store = await import('./js/store.js');
      const prefs = await import('./js/prefs.js');
      const { weekKeyOf, mondayOf, isoDate } = await import('./js/planner.js');
      const plan = await store.getPlan(weekKeyOf(mondayOf(isoDate(new Date()))));
      for (const sl of plan.slots) for (const it of sl.items ?? []) it.locked = false;
      await store.savePlan(plan);
      await prefs.set('heartyLevel', 'low');
    });
    await goto(page, '#/family');
    await titleIs(page, '家人');
    await goto(page, '#/');
    await page.waitForSelector('[data-action="regenerate"]');
    await clickEl(page, '[data-action="regenerate"]');
    await sleep(1500);
    await page.waitForSelector('[data-card="balance"] [data-field="balanceText"]');
    const low = await readBalance();
    // 混合家庭每餐多一道純葷加菜之後，一週的主菜從 14 道變 28 道（SPEC_排菜葷素比例）。
    // 配額是給正規主菜設計的，所以這裡看不含加菜的那一半；加菜照樣算進 weekBalance（plannertest P9 驗）。
    const lowNoExtra = await page.evaluate(async () => {
      const store = await import('./js/store.js');
      const prefs = await import('./js/prefs.js');
      const { weekBalance, weekKeyOf, mondayOf, isoDate } = await import('./js/planner.js');
      const plan = await store.getPlan(weekKeyOf(mondayOf(isoDate(new Date()))));
      const noExtra = { ...plan, slots: plan.slots.map((sl) => ({ ...sl, items: (sl.items ?? []).filter((it) => !it.extraMeat) })) };
      const b = weekBalance({ plan: noExtra, recipes: store.allRecipes(), members: store.members(), idx: store.foodsIndex(), units: store.units(), rules: { heartyLevel: prefs.get('heartyLevel') } });
      return { load: b.load, budget: b.budget };
    });
    ok(lowNoExtra.budget === 2 && lowNoExtra.load <= 2, `家人頁選「少」之後重新產生：不含加菜的豐盛主菜加權 ${lowNoExtra.load} 道（≤ 2）`);
    ok(low.load >= lowNoExtra.load, `（對照）含加菜是 ${low.load} 道 —— 加菜有被算進一週平衡`);
    const t2 = await textOf(page, '[data-card="balance"] [data-field="balanceText"]');
    ok(low.n === 0 ? t2.includes('一週最多 2 道') : t2.includes(`這週有 ${low.n} 餐`), `畫面上的那段話跟著變：「${t2}」`);
    await page.evaluate(async () => { const prefs = await import('./js/prefs.js'); await prefs.set('heartyLevel', 'medium'); });
  }

  section('加菜／減菜：這一餐自己加一道、拿掉一道，購物清單跟著變');
  {
    // 使用者 2026-09-16 要求：有時候某一餐的菜不是固定的。走真實路徑 ——
    // 本週頁按「＋ 加一道」→ 小視窗挑菜 →（買菜頁）那道菜的食材真的出現在清單上。
    // 挑的是「現在的菜單完全沒用到它任何一樣食材」的菜，清單的變化才歸得到它身上。
    const target = await page.evaluate(async () => {
      const store = await import('./js/store.js');
      const { weekKeyOf, mondayOf, isoDate } = await import('./js/planner.js');
      const plan = await store.getPlan(weekKeyOf(mondayOf(isoDate(new Date()))));
      const byId = new Map(store.allRecipes().map((r) => [r.id, r]));
      const used = new Set();
      for (const s of plan.slots) for (const it of s.items ?? []) {
        for (const ing of byId.get(it.recipeId)?.ingredients ?? []) if (!ing.pantry && ing.food) used.add(ing.food);
      }
      for (const r of store.allRecipes()) {
        if (r.role !== 'side') continue;
        const fresh = r.ingredients.filter((i) => !i.pantry && i.food && i.grams > 0 && !used.has(i.food));
        if (fresh.length) return { id: r.id, name: r.name, food: fresh[0].food, foodName: fresh[0].label };
      }
      return null;
    });
    ok(target, `（前提）挑到一道菜單還沒用到它食材的配菜：「${target?.name}」（${target?.foodName}）`);
    const lunchSel = '.meal-block[data-meal="lunch"][data-kind="cook"]';
    const dishCount = () => page.$$eval(`${lunchSel} .meal-item[data-item]`, (els) => els.length);
    const before = await dishCount();
    await clickEl(page, `${lunchSel} [data-action="addDish"]`);
    await page.waitForSelector('[data-field="pickerSearch"]');
    await page.type('[data-field="pickerSearch"]', target.name);
    await sleep(200);
    await clickEl(page, `[data-pick="${target.id}"]`);
    await waitToastGone(page).catch(() => {});
    await page.waitForSelector(`${lunchSel} .meal-item[data-item="${target.id}"]`);
    eq(await dishCount(), before + 1, `這一餐從 ${before} 道變成 ${before + 1} 道`);
    eq(await page.$eval(`${lunchSel} .meal-item[data-item="${target.id}"]`, (el) => el.dataset.added), 'true', '自己加的那道標得出來');
    ok(await page.$(`${lunchSel} .meal-item[data-item="${target.id}"] .lock`) != null, '自己加的預設鎖定（重新產生不會被洗掉）');

    // 購物清單：那道菜的食材真的要買了
    await goto(page, '#/shopping');
    await titleIs(page, '買菜');
    await page.waitForSelector('[data-card="shopRange"]');
    const gramsOfFood = (food) => page.$$eval(`[data-buy="${food}"] .shop-qty`, (els) => {
      if (!els.length) return null;
      const m = /(\d+)\s*g/.exec(els[0].textContent.replace(/,/g, ''));
      return m ? Number(m[1]) : null;
    });
    ok(await page.$(`[data-buy="${target.food}"]`) != null, `買菜清單多了「${target.foodName}」`);
    const gramsWithDish = await gramsOfFood(target.food);

    // 重新產生：鎖住的自己加的菜還在
    await goto(page, '#/');
    await titleIs(page, '本週菜單');
    await page.waitForSelector('[data-action="regenerate"]');
    await waitToastGone(page).catch(() => {});
    await clickEl(page, '[data-action="regenerate"]');
    await page.waitForFunction(() => { const t = document.getElementById('toast'); return t && !t.hidden && t.textContent.includes('已重新排好'); });
    await sleep(500);
    ok(await page.$(`${lunchSel} .meal-item[data-item="${target.id}"]`) != null, '重新產生之後，自己加的那道還在');

    // 拿掉這道：清單也要跟著少買
    // 道數跟「拿掉前」比：中間按過重新產生，沒鎖的菜會換（主菜換成本身含主食的，那一餐就少一格主食）
    const beforeRemove = await dishCount();
    await clickEl(page, `${lunchSel} .meal-item[data-item="${target.id}"] .item-menu`);
    await page.waitForSelector('.modal-card .modal-actions');
    await page.evaluate(() => { [...document.querySelectorAll('.modal-card .modal-actions .btn')].find((b) => b.textContent.includes('拿掉這道'))?.click(); });
    await page.waitForFunction((sel, id) => !document.querySelector(`${sel} .meal-item[data-item="${id}"]`), {}, lunchSel, target.id);
    eq(await dishCount(), beforeRemove - 1, `拿掉之後從 ${beforeRemove} 道變成 ${beforeRemove - 1} 道`);
    await goto(page, '#/shopping');
    await titleIs(page, '買菜');
    await page.waitForSelector('[data-card="shopRange"]');
    // 混合家庭每餐都有純葷加菜（SPEC_排菜葷素比例），中間又按過「重新產生」——
    // 別的菜也可能用到同一樣食材，所以驗的是「變少了」，不是「一定消失」。
    const gramsAfterRemove = await gramsOfFood(target.food);
    ok(gramsAfterRemove === null || (gramsWithDish != null && gramsAfterRemove < gramsWithDish),
      `拿掉那道之後，買菜清單的「${target.foodName}」跟著變少（${gramsWithDish} g → ${gramsAfterRemove === null ? '不用買了' : `${gramsAfterRemove} g`}）`);
    await goto(page, '#/');
    await titleIs(page, '本週菜單');
  }

  section('本週想吃：真的按「本週想吃」、真的按「重新產生」，每次都排進去；排不進去的照實講');
  {
    // 2026-09-14 使用者回報：加了「滷雞腳」、按本週想吃，重新產生幾次都沒排進去。這個家有蛋奶素的阿嬤、全素（不吃五辛）的姊。
    // 走真實路徑（食譜頁的按鈕 → store → 本週頁的「重新產生」→ generateWeek），不是只測內層函式（「家裡有」那次的教訓）。
    const regen = async () => {
      await waitToastGone(page).catch(() => {});
      await clickEl(page, '[data-action="regenerate"]');
      await page.waitForFunction(() => { const t = document.getElementById('toast'); return t && !t.hidden && t.textContent.includes('已重新排好'); });
      await sleep(500);
    };
    const feetId = await page.evaluate(async () => {
      const store = await import('./js/store.js');
      const { recipe, errors } = await store.saveUserRecipe({ id: store.newUserRecipeId(), name: '滷雞腳', role: 'main', servings: 4, time: 0, method: 'stirfry', vegMode: 'meatOnly', texture: 'normal', season: [], source: 'user',
        ingredients: [{ food: '', label: '雞腳', grams: 300, track: 'base' }], steps: [{ stage: 'base', type: 'cook', text: '加熱' }] });
      if (errors.length) throw new Error(errors.join('；'));
      return recipe.id;
    });
    await goto(page, `#/recipes/${feetId}`);
    await titleIs(page, '滷雞腳');
    await sleep(200);
    await clickEl(page, '[data-action="wantThisWeek"]');
    await page.waitForFunction(() => document.querySelector('[data-action="wantThisWeek"]')?.textContent === '✓ 本週想吃');
    await goto(page, '#/');
    await titleIs(page, '本週菜單');
    await page.waitForSelector('[data-action="regenerate"]');
    const counts = [];
    for (let i = 0; i < 3; i += 1) {
      await regen();
      counts.push(await page.$$eval('.meal-item[data-item]', (els, id) => els.filter((e) => e.dataset.item === id).length, feetId));
    }
    everyOf(counts, (n) => n === 1, `按了 3 次「重新產生」，滷雞腳每次都在菜單上剛好一次（${counts.join('、')}）`);
    ok(!(await page.$('[data-card="wantMissed"]')), '排進去了就沒有「沒排進去」那張卡');

    // 排不進去的：要 300 分鐘的菜，每一餐都超過時間上限
    await page.evaluate(async () => {
      const store = await import('./js/store.js');
      const { recipe, errors } = await store.saveUserRecipe({ id: store.newUserRecipeId(), name: '慢燉牛腱', role: 'main', servings: 4, time: 300, method: 'stirfry', vegMode: 'meatOnly', vegModeConfirmed: true, texture: 'normal', season: [], source: 'user',
        ingredients: [{ food: '', label: '牛腱', grams: 600, track: 'base' }], steps: [] });
      if (errors.length) throw new Error(errors.join('；'));
      await store.setWantThisWeek(recipe.id, true);
    });
    await goto(page, '#/family');
    await titleIs(page, '家人');
    await goto(page, '#/');
    await page.waitForSelector('[data-action="regenerate"]');
    await regen();
    await page.waitForSelector('[data-card="wantMissed"]');
    const missedText = await textOf(page, '[data-card="wantMissed"]');
    ok(missedText.includes('你想吃的「慢燉牛腱」這週沒排進去，因為') && missedText.includes('300 分鐘'), `排不進去的照實講、講原因：「${missedText}」`);
    ok(!missedText.includes('滷雞腳'), '（對照）排進去的滷雞腳不在這張卡上');
    eq(await page.$$eval('.meal-item[data-item]', (els, id) => els.filter((e) => e.dataset.item === id).length, feetId), 1, '（對照）滷雞腳這次也排進去了');
    noneOf(['健康', '降', '控制', '療效', '治療'], (w) => missedText.includes(w), '沒有療效字眼');

    // 2026-09-17 使用者回報：同一道滷雞腳**填成配菜**時又排不進去了，本週頁寫
    // 「這道只有吃葷的人能吃，奶奶吃素」。根因是加菜格以前只從主菜裡挑。
    const sideId = await page.evaluate(async () => {
      const store = await import('./js/store.js');
      const { recipe, errors } = await store.saveUserRecipe({ id: store.newUserRecipeId(), name: '滷雞腳（配菜版）', role: 'side', servings: 4, time: 30, method: 'braise', vegMode: 'meatOnly', vegModeConfirmed: true, texture: 'normal', season: [], source: 'user',
        ingredients: [{ food: '', label: '雞腳', grams: 400, track: 'base' }], steps: [{ stage: 'base', type: 'cook', text: '滷 30 分鐘' }] });
      if (errors.length) throw new Error(errors.join('；'));
      await store.setWantThisWeek(recipe.id, true);
      return recipe.id;
    });
    await goto(page, '#/family');
    await titleIs(page, '家人');
    await goto(page, '#/');
    await page.waitForSelector('[data-action="regenerate"]');
    await regen();
    const sideRows = await page.$$eval('.meal-item[data-item]', (els, id) => els.filter((e) => e.dataset.item === id).map((e) => ({
      extra: e.dataset.extra ?? null,
      role: e.dataset.role,
      pills: [...e.querySelectorAll('.pill')].map((p) => p.textContent.trim()),
      meal: e.closest('.meal-block')?.dataset.meal ?? null,
    })), sideId);
    eq(sideRows.length, 1, '填成配菜的滷雞腳也排進去了，剛好一次');
    eq(sideRows[0].extra, 'meat', '走的是「加菜」那一格');
    ok(sideRows[0].pills.includes('加菜') && sideRows[0].pills.includes('僅葷食成員'), `畫面上標了 ${JSON.stringify(sideRows[0].pills)}`);
    ok(sideRows[0].meal !== 'breakfast', `排在${sideRows[0].meal === 'lunch' ? '午餐' : '晚餐'}，不是早餐`);
    const missed2 = (await page.$('[data-card="wantMissed"]')) ? await textOf(page, '[data-card="wantMissed"]') : '';
    ok(!missed2.includes('滷雞腳（配菜版）'), '本週頁不再說它「排不進去」');
    ok(missed2.includes('慢燉牛腱'), '（對照）真的排不進去的那道還在卡片上 —— 上面那條不是因為整張卡不見了');
    // 紅線：那一餐兩位素食成員照樣吃得到 3 道
    const vegOk = await page.evaluate(async (id) => {
      const store = await import('./js/store.js');
      const { versionFor } = await import('./js/members.js');
      const { mondayOf, weekKeyOf, isoDate } = await import('./js/planner.js');
      const plan = await store.getPlan(weekKeyOf(mondayOf(isoDate(new Date()))));
      const all = new Map(store.allRecipes().map((r) => [r.id, r]));
      const slot = plan.slots.find((s) => (s.items ?? []).some((it) => it.recipeId === id));
      const vegs = store.members().filter((m) => m.diet !== 'omni');
      return {
        names: vegs.map((m) => m.name),
        counts: vegs.map((m) => slot.items.filter((it) => versionFor(all.get(it.recipeId), m.diet) !== null).length),
      };
    }, sideId);
    everyOf(vegOk.counts, (n) => n >= 3, `那一餐 ${vegOk.names.join('、')} 仍各吃得到 ≥ 3 道（${vegOk.counts.join('、')}）`);

    // 收尾：把這道菜撤掉，後面幾節的母體維持原樣
    await page.evaluate(async (id) => {
      const store = await import('./js/store.js');
      await store.setWantThisWeek(id, false);
      await store.deleteUserRecipe(id);
    }, sideId);
    await goto(page, '#/family');
    await titleIs(page, '家人');
    await goto(page, '#/');
    await page.waitForSelector('[data-action="regenerate"]');
    await regen();
  }

  section('排菜葷素比例：混合家庭每個午晚餐一道純葷加菜（走真實畫面與按鈕）');
  {
    // SPEC_排菜葷素比例（2026-09-16 定案）。這一家是爸（葷）、阿嬤（蛋奶素）、姊（全素）＝混合家庭。

    // 在瀏覽器端查食譜：加菜可能是使用者自己加的（這支測試前面建過滷雞腳），Node 端的 byId 只有內建食譜。
    const readMeals = () => page.evaluate(async () => {
      const store = await import('./js/store.js');
      const { versionFor } = await import('./js/members.js');
      const all = new Map(store.allRecipes().map((r) => [r.id, r]));
      return [...document.querySelectorAll('.meal-block[data-kind="cook"]')]
        .filter((e) => e.dataset.meal !== 'breakfast')
        .map((e) => {
          const ids = [...e.querySelectorAll('.meal-item[data-item]')].map((x) => x.dataset.item);
          return {
            meal: e.dataset.meal,
            ids,
            vegEatable: ids.filter((id) => all.get(id) && versionFor(all.get(id), 'veganNoAllium') !== null).length,
            extras: [...e.querySelectorAll('.meal-item[data-extra="meat"]')].map((x) => ({
              id: x.dataset.item, role: x.dataset.role, pos: x.dataset.pos,
              vegMode: all.get(x.dataset.item)?.vegMode ?? null,
              pills: [...x.querySelectorAll('.pill')].map((p) => p.textContent.trim()),
            })),
          };
        });
    });
    const regen = async () => {
      await waitToastGone(page).catch(() => {});
      await clickEl(page, '[data-action="regenerate"]');
      await page.waitForFunction(() => { const t = document.getElementById('toast'); return t && !t.hidden && t.textContent.includes('已重新排好'); });
      await sleep(500);
    };

    // W1：按三次「重新產生」，每一次都要成立
    for (let round = 1; round <= 3; round += 1) {
      await regen();
      const meals = await readMeals();
      eq(meals.length, 14, `第 ${round} 次重新產生：14 個午晚餐`);
      everyOf(meals, (m) => m.extras.length <= 1, `第 ${round} 次：一餐最多一道加菜`);
      const withExtra = meals.filter((m) => m.extras.length === 1);
      ok(withExtra.length >= 10, `第 ${round} 次：有加菜的 ${withExtra.length}／14 餐`);
      everyOf(meals.flatMap((m) => m.extras), (x) => x.vegMode === 'meatOnly', `第 ${round} 次：加菜都是純葷的菜`);
      everyOf(meals.flatMap((m) => m.extras), (x) => x.pills.includes('加菜') && x.pills.includes('僅葷食成員'), `第 ${round} 次：加菜標了「加菜」「僅葷食成員」`);
      const noExtra = meals.filter((m) => m.extras.length === 0);
      // 兩種情況都要有斷言：有沒放加菜的，就要說得出為什麼；一餐都沒漏，就直接斷言 14 餐全有。
      if (noExtra.length) {
        everyOf(noExtra, (m) => m.vegEatable <= 3,
          `第 ${round} 次：沒放加菜的 ${noExtra.length} 餐，是因為姊只吃得到 3 道（再放就少於 3）`);
      } else {
        eq(withExtra.length, meals.length, `第 ${round} 次：14 個午晚餐全部都放了加菜`);
      }
      everyOf(meals, (m) => m.vegEatable >= 3, `第 ${round} 次：每一餐姊仍吃得到 ≥ 3 道（最少 ${Math.min(...meals.map((m) => m.vegEatable))} 道）`);
    }

    // W2：在加菜上「換一道」→ 仍是純葷、仍標加菜
    const mealsNow = await readMeals();
    const firstExtra = mealsNow.find((m) => m.extras.length === 1);
    ok(firstExtra, '（前提）找得到一餐有加菜');
    await clickEl(page, `.meal-item[data-extra="meat"][data-item="${firstExtra.extras[0].id}"] .item-menu`);
    await page.waitForSelector('.modal-card .modal-actions');
    await page.evaluate(() => { [...document.querySelectorAll('.modal-card .modal-actions .btn')].find((b) => b.textContent.includes('換一道'))?.click(); });
    await waitToastGone(page).catch(() => {});
    await sleep(700);
    const afterSwap = await readMeals();
    const swapped = afterSwap.find((m) => m.meal === firstExtra.meal && m.extras.length === 1);
    ok(swapped, '換一道之後那一餐仍有加菜');
    eq(swapped.extras[0].vegMode, 'meatOnly', '換到的還是純葷的菜');
    ok(swapped.extras[0].pills.includes('僅葷食成員'), '仍然標「僅葷食成員」');

    // W3：把加菜拿掉 → 那一格變空的（角色是配菜，加菜佔的本來就是配菜的位置）
    await clickEl(page, `.meal-item[data-extra="meat"][data-item="${swapped.extras[0].id}"] .item-menu`);
    await page.waitForSelector('.modal-card .modal-actions');
    await page.evaluate(() => { [...document.querySelectorAll('.modal-card .modal-actions .btn')].find((b) => b.textContent.includes('拿掉這道'))?.click(); });
    await waitToastGone(page).catch(() => {});
    await sleep(700);
    const emptyCells = await page.$$eval('.meal-item.empty', (els) => els.map((e) => ({ role: e.dataset.role, text: e.textContent })));
    ok(emptyCells.some((c) => c.text.includes('這格沒有菜')), '拿掉之後那一格是空的');
    ok(emptyCells.some((c) => c.role === 'side'), '空的那一格角色是配菜');

    // W4：某餐設外食再改回自己煮（走 regenerateSlot → refillSlot）→ 那一餐也照同一條規則排
    await regen();
    await clickEl(page, '.meal-block[data-meal="lunch"][data-kind="cook"] [data-action="kind"]');
    await page.waitForSelector('.modal-card .modal-actions');
    await page.evaluate(() => { [...document.querySelectorAll('.modal-card .modal-actions .btn')].find((b) => b.textContent === '外食')?.click(); });
    await page.waitForSelector('.meal-block[data-meal="lunch"][data-kind="eatOut"]');
    await sleep(400);
    await clickEl(page, '.meal-block[data-meal="lunch"][data-kind="eatOut"] [data-action="kind"]');
    await page.waitForSelector('.modal-card .modal-actions');
    await page.evaluate(() => { [...document.querySelectorAll('.modal-card .modal-actions .btn')].find((b) => b.textContent === '自己煮')?.click(); });
    await page.waitForSelector('.meal-block[data-meal="lunch"][data-kind="cook"]');
    await sleep(800);
    const refilled = (await readMeals()).find((m) => m.meal === 'lunch');
    ok(refilled.ids.length >= 3, `改回自己煮之後那一餐有 ${refilled.ids.length} 道`);
    ok(refilled.vegEatable >= 3, `姊仍吃得到 ${refilled.vegEatable} 道（≥ 3）`);
    ok(refilled.extras.length === 1 || refilled.vegEatable <= 3,
      `改回自己煮的那一餐走的是同一條規則：加菜 ${refilled.extras.length} 道`);
  }

  eq(pageErrors, [], '沒有未攔截的例外');
} finally {
  await close();
}
done('weekviewtest');

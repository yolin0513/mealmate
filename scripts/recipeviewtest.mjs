// 食譜畫面（npm run recipeviewtest，puppeteer）：篩選、誰要吃、營養標示（估、素葷分開、人份）、收藏與本週想吃、我的食譜。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ok, eq, section, done, everyOf, noneOf } from './tap.mjs';
import { openApp, acceptWelcome, goto, titleIs, chipSel, textOf, sleep, waitToastGone, clickEl } from './browserlib.mjs';
import { fitsDiet } from '../js/members.js';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const recipes = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/recipes.json'), 'utf8')).recipes;
const byId = new Map(recipes.map((r) => [r.id, r]));

const rowIds = (page) => page.$$eval('[data-list="recipes"] a.row', (els) => els.map((e) => e.dataset.recipe));
const nutriValues = (page) => page.$$eval('[data-card="recipeNutrition"] .nutri-value', (els) => els.map((e) => ({ k: e.dataset.nutrient, t: e.textContent.trim(), partial: e.dataset.partial })));

const { page, pageErrors, close } = await openApp();
try {
  await acceptWelcome(page);

  section('清單與篩選（種類是分段控制）');
  await goto(page, '#/recipes');
  await titleIs(page, '食譜');
  await page.waitForSelector('[data-list="recipes"] a.row');
  const all = await rowIds(page);
  // 2026-09-16：種類篩選改成分段控制（一條軌道、等寬格子）。這裡驗的是「它還是同一個篩選」與選中狀態。
  const segState = () => page.evaluate(() => [...document.querySelectorAll('[data-field="kindFilters"] .seg')]
    .map((b) => ({ key: b.dataset.filter, on: b.getAttribute('aria-pressed') })));
  const segs0 = await segState();
  eq(segs0.map((s) => s.key), ['all', 'veg', 'split', 'meat', 'mine', 'fav', 'want'], '七格分段控制，順序固定');
  eq(segs0.filter((s) => s.on === 'true').map((s) => s.key), ['all'], '預設選中「全部」');
  // 2026-09-16：「誰要吃：不限」那塊下拉整個移除（使用者要求上方少一塊）
  eq(await page.$$eval('[data-field="eater"]', (els) => els.length), 0, '「誰要吃」的下拉已經不在畫面上');
  eq(await page.$$eval('[data-field="needFilters"] .chip', (els) => els.map((e) => e.dataset.filter)), ['quick', 'soft', 'season', 'lowCarb', 'lowSodium'],
    '需求篩選還是那五顆（20 分內／軟質／當季／醣較低／鈉較低）');
  // 2026-09-18：五顆收進「更多選項」，預設收起；勾了才自動展開並在標題寫出已選幾項
  const more0 = await page.evaluate(() => { const d = document.querySelector('[data-field="moreFilters"]'); return { open: d.open, summary: d.querySelector('summary').textContent, chipVisible: d.querySelector('.chip').checkVisibility() }; });
  eq(more0.open, false, '「更多選項」預設收起');
  eq(more0.chipVisible, false, '收起時五顆 chip 真的看不到');
  eq(more0.summary, '更多選項', '標題就是「更多選項」');
  await page.evaluate(() => { document.querySelector('[data-field="moreFilters"]').open = true; });
  await sleep(100);
  ok(all.length >= 36, `全部 ${all.length} 道`);
  await clickEl(page, '[data-filter="veg"]');
  await sleep(100);
  eq((await segState()).filter((s) => s.on === 'true').map((s) => s.key), ['veg'], '按「素」→ 只有它是選中的（分段控制一次只選一格）');
  const vegRows = await rowIds(page);
  ok(vegRows.length >= 8 && vegRows.length < all.length, `（母體）素 ${vegRows.length} 道`);
  everyOf(vegRows, (id) => byId.get(id)?.vegMode === 'nativeVeg', '「素」篩選後每一道都是 nativeVeg');
  await clickEl(page, '[data-filter="quick"]');
  await sleep(100);
  eq(await page.$eval('[data-field="moreFilters"] summary', (el) => el.textContent), '更多選項（已選 1 項）', '勾了一項之後標題寫出「已選 1 項」');
  const quickVeg = await rowIds(page);
  ok(quickVeg.length >= 3, `（母體）素＋20 分內 ${quickVeg.length} 道`);
  everyOf(quickVeg, (id) => byId.get(id).vegMode === 'nativeVeg' && byId.get(id).time <= 20, '兩個篩選是 AND');
  await clickEl(page, '[data-filter="quick"]');
  await clickEl(page, '[data-filter="all"]');
  await sleep(100);

  section('醣較低：門檻是池子的中位數');
  await clickEl(page, '[data-filter="lowCarb"]');
  await sleep(150);
  const lowCarb = await rowIds(page);
  const countText = await textOf(page, '[data-field="recipeCount"]');
  ok(lowCarb.length >= 5 && lowCarb.length <= all.length / 2 + 1, `醣較低 ${lowCarb.length} 道（約一半以下）`);
  ok(/醣較低＝每份低於 \d+ g（這個池子的中位數）/.test(countText), `說明寫出門檻與它的來由：${countText}`);
  await clickEl(page, '[data-filter="lowCarb"]');

  section('可分流的菜：素版葷版分開、人份可調、每個數字帶「估」');
  await goto(page, '#/recipes/r-cabbage-pork-stirfry');
  await titleIs(page, '高麗菜炒肉片');
  await page.waitForSelector('[data-card="recipeNutrition"] .nutri-value');
  const meatVals = await nutriValues(page);
  ok(meatVals.length >= 12, `（母體）${meatVals.length} 個營養值節點`);
  everyOf(meatVals, (v) => /^估 /.test(v.t) || v.t.startsWith('未估算'), '每個營養值都以「估」開頭或是「未估算」');
  const ingMeat = await page.$$eval('[data-card="recipeIngredients"] tbody tr', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ')));
  ok(ingMeat.some((t) => t.includes('豬里肌肉片')) && !ingMeat.some((t) => t.includes('乾香菇')), '預設葷版：食材表有豬肉、沒有乾香菇');
  const proteinMeat = meatVals.find((v) => v.k === 'protein').t;
  await clickEl(page, chipSel('version', 'veg'));
  await sleep(150);
  const vegVals = await nutriValues(page);
  const proteinVeg = vegVals.find((v) => v.k === 'protein').t;
  ok(proteinMeat !== proteinVeg, `素版與葷版的蛋白質不同（葷 ${proteinMeat}、素 ${proteinVeg}）`);
  const num = (t) => Number(String(t).replace(/[^\d.]/g, ''));
  ok(num(proteinVeg) < num(proteinMeat), '素版蛋白質低於葷版（豬肉只在葷鍋）');
  const ingVeg = await page.$$eval('[data-card="recipeIngredients"] tbody tr', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ')));
  ok(ingVeg.some((t) => t.includes('乾香菇')) && !ingVeg.some((t) => t.includes('豬里肌肉片')), '素版：食材表有乾香菇、沒有豬肉');
  eq(await textOf(page, '[data-stepper="人份"]'), '1', '素版預設 1 人份');
  const cabbageBefore = ingVeg.find((t) => t.startsWith('高麗菜'));
  await clickEl(page, '.stepper-btn[aria-label="人份加一"]');
  await sleep(150);
  eq(await textOf(page, '[data-stepper="人份"]'), '2', '加一 → 2 人份');
  const vegVals2 = await nutriValues(page);
  eq(vegVals2.map((v) => v.t), vegVals.map((v) => v.t), '每人一份的數字不因人份改變');
  const cabbageAfter = (await page.$$eval('[data-card="recipeIngredients"] tbody tr', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ')))).find((t) => t.startsWith('高麗菜'));
  ok(cabbageBefore !== cabbageAfter && num(cabbageAfter) === num(cabbageBefore) * 2, `食材克數跟著人份變（${cabbageBefore} → ${cabbageAfter}）`);
  section('營養標示：預設熱量＋蛋白質，12 項收在展開區');
  const mainFields = await page.$$eval('[data-card="recipeNutrition"] [data-field="mainFields"] .nutri-value', (els) => els.map((e) => e.dataset.nutrient));
  eq(mainFields, ['kcal', 'protein'], '沒有人設留意項目 → 主要區塊只有熱量與蛋白質');
  const allDetails = await page.$eval('[data-card="recipeNutrition"] [data-field="allFields"]', (el) => ({ open: el.open, summary: el.querySelector('summary').textContent.trim(), n: el.querySelectorAll('.nutri-value').length }));
  eq(allDetails.open, false, '全部 12 項預設是收起來的');
  eq(allDetails.n, 12, `展開區裡有 12 項（${allDetails.summary}）`);
  // 加一位糖尿病家人 → 醣、糖、膳食纖維要直接出現在主要區塊
  await page.evaluate(async () => {
    const store = await import('./js/store.js');
    const { newMember } = await import('./js/members.js');
    await store.saveMember({ ...newMember(), name: '阿公', conditions: ['diabetes'] });
  });
  await goto(page, '#/recipes');
  await titleIs(page, '食譜');
  await goto(page, '#/recipes/r-cabbage-pork-stirfry');
  await page.waitForSelector('[data-card="recipeNutrition"] [data-field="mainFields"] .nutri-value');
  const withWatch = await page.$$eval('[data-card="recipeNutrition"] [data-field="mainFields"] .nutri-value', (els) => els.map((e) => e.dataset.nutrient));
  eq(withWatch, ['kcal', 'protein', 'carb', 'sugar', 'fiber'], '有糖尿病家人 → 醣、糖、膳食纖維加顯在主要區塊（不是收進展開區）');
  ok((await textOf(page, '[data-card="recipeNutrition"]')).includes('家人設定的留意項目'), '而且講明後面那幾項是家人設定的留意項目');
  await page.evaluate(async () => {
    const store = await import('./js/store.js');
    for (const mm of store.members()) await store.deleteMember(mm.id);
  });
  await goto(page, '#/recipes');
  await titleIs(page, '食譜');
  await goto(page, '#/recipes/r-cabbage-pork-stirfry');
  await page.waitForSelector('[data-card="recipeNutrition"] [data-field="mainFields"] .nutri-value');

  const howText = await textOf(page, '[data-card="recipeNutrition"] [data-field="how"]');
  ok(howText.includes('食品藥物管理署') && howText.includes('未計烹調'), '「怎麼算的」有食藥署來源與「未計烹調」');
  ok(howText.includes('→ 甘藍平均值'), '「怎麼算的」列出對到的食藥署條目');
  ok(!/份醣|醣類份數|份的醣/.test(await textOf(page, '#view')), '沒有出現醣類份數（尚無可引用來源，不顯示）');

  section('「本週想吃」和「收藏」各自獨立：按一個，另一個不動');
  {
    // 2026-09-14 使用者回報：按「本週想吃」，「收藏」會一起亮。根因：兩個開關存在同一筆紀錄，
    // 「有紀錄」就被當成已收藏，而本週想吃會順手建紀錄。
    const soloId = recipes.filter((r) => r.id !== 'r-cabbage-pork-stirfry')[12].id;
    const favState = () => page.evaluate(async (id) => { const s = await import('./js/store.js'); return { fav: s.isFavorite(id), want: s.wantThisWeekIds().includes(id), row: !!s.favorite(id) }; }, soloId);
    const buttons = async () => ({ fav: await textOf(page, '[data-action="favorite"]'), want: await textOf(page, '[data-action="wantThisWeek"]') });
    await goto(page, `#/recipes/${soloId}`);
    await titleIs(page, byId.get(soloId).name);
    await sleep(200);
    eq(await buttons(), { fav: '♡ 收藏', want: '本週想吃' }, '（前提）兩個都還沒按');
    await clickEl(page, '[data-action="wantThisWeek"]');
    await page.waitForFunction(() => document.querySelector('[data-action="wantThisWeek"]')?.textContent === '✓ 本週想吃');
    eq((await buttons()).fav, '♡ 收藏', '按「本週想吃」之後，「收藏」沒有一起亮');
    eq(await favState(), { fav: false, want: true, row: true }, '資料上也是：勾了本週想吃、沒有收藏');
    await goto(page, '#/recipes');
    await titleIs(page, '食譜');
    await clickEl(page, '[data-filter="fav"]');
    await sleep(150);
    ok(!(await rowIds(page)).includes(soloId), '食譜清單的「收藏」篩選裡沒有它');
    await clickEl(page, '[data-filter="want"]');
    await sleep(150);
    ok((await rowIds(page)).includes(soloId), '「本週想吃」篩選裡有它（只勾了本週想吃的菜找得到地方取消）');
    await clickEl(page, '[data-filter="all"]');
    await sleep(100);
    await goto(page, `#/recipes/${soloId}`);
    await titleIs(page, byId.get(soloId).name);
    await sleep(200);
    eq(await buttons(), { fav: '♡ 收藏', want: '✓ 本週想吃' }, '重新進這一頁（從資料重畫）：收藏沒亮、本週想吃亮著');
    // 反過來：按收藏，本週想吃不動；取消收藏，本週想吃也還在
    await clickEl(page, '[data-action="favorite"]');
    await page.waitForFunction(() => document.querySelector('[data-action="favorite"]')?.textContent === '♥ 已收藏');
    eq((await buttons()).want, '✓ 本週想吃', '按「收藏」之後，本週想吃還是勾著');
    await clickEl(page, '[data-action="favorite"]');
    await page.waitForFunction(() => document.querySelector('[data-action="favorite"]')?.textContent === '♡ 收藏');
    eq((await buttons()).want, '✓ 本週想吃', '取消收藏，本週想吃沒有被一起取消');
    eq(await favState(), { fav: false, want: true, row: true }, '資料上本週想吃還在');
    await clickEl(page, '[data-action="wantThisWeek"]');
    await page.waitForFunction(() => document.querySelector('[data-action="wantThisWeek"]')?.textContent === '本週想吃');
    eq(await favState(), { fav: false, want: false, row: false }, '兩個都取消 → 那筆紀錄刪掉（不留空紀錄）');
    await goto(page, '#/recipes/r-cabbage-pork-stirfry');
    await titleIs(page, '高麗菜炒肉片');
    await page.waitForSelector('[data-action="favorite"]');
    await sleep(200);
  }

  section('收藏與本週想吃（最多 7 道）');
  await clickEl(page, '[data-action="favorite"]');
  await sleep(150);
  eq(await textOf(page, '[data-action="favorite"]'), '♥ 已收藏', '按收藏 → 已收藏');
  const seven = recipes.filter((r) => r.id !== 'r-cabbage-pork-stirfry').slice(0, 7).map((r) => r.id);
  const setRes = await page.evaluate(async (ids) => {
    const store = await import('./js/store.js');
    const out = [];
    for (const id of ids) out.push((await store.setWantThisWeek(id, true)).ok);
    return { out, count: store.wantThisWeekIds().length };
  }, seven);
  everyOf(setRes.out, (x) => x === true, '前 7 道都勾得起來');
  eq(setRes.count, 7, '本週想吃 7 道');
  await clickEl(page, '[data-action="wantThisWeek"]');
  await page.waitForSelector('#toast.show');
  const toastText = await textOf(page, '#toast');
  ok(toastText.includes('最多 7 道'), `第 8 道被擋下並說明：${toastText}`);
  eq(await textOf(page, '[data-action="wantThisWeek"]'), '本週想吃', '按鈕沒有變成已勾');
  eq(await page.evaluate(async () => (await import('./js/store.js')).wantThisWeekIds().length), 7, '仍然 7 道');
  await page.evaluate(async (id) => { const s = await import('./js/store.js'); await s.setWantThisWeek(id, false); }, seven[0]);
  await clickEl(page, '[data-action="wantThisWeek"]');
  await sleep(150);
  eq(await textOf(page, '[data-action="wantThisWeek"]'), '✓ 本週想吃', '取消一道之後就勾得起來');

  section('我的食譜：沒填克數 → 未估算，不是 0');
  await goto(page, '#/recipes/new');
  await titleIs(page, '新增食譜');
  await page.waitForSelector('[data-field="recipeName"]');
  const splitBoxShown = () => page.$eval('[data-card="editBasics"] .sub-block', (el) => getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().height > 0);
  eq(await splitBoxShown(), false, '預設「素」的新食譜看不到「素食那鍋幾人份」的區塊');
  await clickEl(page, chipSel('vegMode', 'splittable'));
  await sleep(100);
  eq(await splitBoxShown(), true, '切到可分流才出現');
  await clickEl(page, chipSel('vegMode', 'nativeVeg'));
  await sleep(100);
  await page.type('[data-field="recipeName"]', '我的燙青菜');
  await page.type('[data-ingredient="0"] [data-field="ingLabel"]', '青江菜');
  await page.waitForSelector('[data-ingredient="0"] .picker-item');
  await clickEl(page, '[data-ingredient="0"] .picker-item');
  await sleep(100);
  ok((await textOf(page, '[data-ingredient="0"] [data-field="pickedFood"]')).includes('青江菜'), '選到青江菜的條目');
  // 2026-09-18 Yolin：步驟預設 0 步，要才按「新增步驟」（之前是預設 1 步）。
  eq((await page.$$('[data-list="steps"] textarea')).length, 0, '預設 0 步：沒有任何步驟輸入框');
  ok((await textOf(page, '[data-field="noSteps"]')).includes('還沒有步驟'), '0 步時講一句「還沒有步驟」，不是一塊空白');
  eq((await textOf(page, '[data-action="addStep"]')).trim(), '＋ 新增步驟', '按鈕叫「＋ 新增步驟」');
  await clickEl(page, '[data-action="addStep"]');
  await sleep(120);
  eq((await page.$$('[data-list="steps"] textarea')).length, 1, '按一下 → 出現第一個步驟框');
  eq(await page.$$('[data-field="noSteps"]').then((x) => x.length), 0, '有步驟之後「還沒有步驟」那句不見了');
  await clickEl(page, '[data-action="addStep"]');
  await clickEl(page, '[data-action="addStep"]');
  await sleep(120);
  const stepAreas = await page.$$('[data-list="steps"] textarea');
  eq(stepAreas.length, 3, '再按兩下變成三步');
  for (const [i, ta] of stepAreas.entries()) await ta.type(`第${i + 1}步：洗、燙、盛盤。`);
  await waitToastGone(page);
  await clickEl(page, '[data-action="saveRecipe"]');
  await titleIs(page, '我的燙青菜');
  await page.waitForSelector('[data-card="recipeNutrition"]');
  ok(!/\b(null|undefined|NaN)\b/.test(await textOf(page, '#view')), '沒有家人時的營養卡沒有漏出「null」字（實際發生過：replaceChildren(null)）');
  const mineVals = await nutriValues(page);
  ok(mineVals.length >= 12, `（母體）${mineVals.length} 個營養值`);
  everyOf(mineVals, (v) => v.t === '未估算', '沒填克數 → 每一項都是「未估算」');
  noneOf(mineVals, (v) => /\b0(\.0)? (g|mg|kcal)/.test(v.t), '沒有任何一項顯示 0');
  const nutriText = await textOf(page, '[data-card="recipeNutrition"]');
  ok(nutriText.includes('沒填克數'), '說明寫出是因為沒填克數');
  const mineId = await page.evaluate(() => location.hash.replace('#/recipes/', ''));
  ok(/^r-user-/.test(mineId), `我的食譜 id：${mineId}`);

  section('補上克數之後有估計值');
  await goto(page, `#/recipes/${mineId}/edit`);
  await titleIs(page, '修改食譜');
  await page.waitForSelector('[data-ingredient="0"] [data-field="ingQty"]');
  // 2026-09-18 起數量旁邊有單位（青江菜預設「把」）；這一段驗的是克數，先切回克
  await page.select('[data-ingredient="0"] [data-field="ingUnit"]', '克');
  await page.type('[data-ingredient="0"] [data-field="ingQty"]', '200');
  await waitToastGone(page);
  await clickEl(page, '[data-action="saveRecipe"]');
  await titleIs(page, '我的燙青菜');
  await page.waitForSelector('[data-card="recipeNutrition"] .nutri-value');
  const mineVals2 = await nutriValues(page);
  const kcal = mineVals2.find((v) => v.k === 'kcal').t;
  ok(/^估 \d/.test(kcal), `熱量有估計值：${kcal}`);

  section('新增食譜的食材（2026-09-18 第 6 項）：只列簡名、名稱跟著換、用顆／把／大匙填');
  {
    await goto(page, '#/recipes');
    await titleIs(page, '食譜');
    await goto(page, '#/recipes/new');
    await titleIs(page, '新增食譜');
    await page.waitForSelector('[data-field="recipeName"]');
    await page.type('[data-field="recipeName"]', '單位測試菜');
    await clickEl(page, chipSel('vegMode', 'meatOnly'));
    const row = (i) => `[data-ingredient="${i}"]`;
    const searchFor = async (i, q) => {
      await page.$eval(`${row(i)} [data-field="ingLabel"]`, (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }, q);
      await sleep(120);
      return page.$$eval(`${row(i)} .picker-item`, (els) => els.map((e) => e.textContent));
    };
    const pickFirst = async (i) => { await clickEl(page, `${row(i)} .picker-item`); await sleep(120); };
    const val = (i, f) => page.$eval(`${row(i)} [data-field="${f}"]`, (el) => el.value);
    const txt = (i, f) => textOf(page, `${row(i)} [data-field="${f}"]`);
    const unitsOf = (i) => page.$$eval(`${row(i)} [data-field="ingUnit"] option`, (els) => els.map((e) => e.value));
    const setQty = async (i, q) => {
      await page.$eval(`${row(i)} [data-field="ingQty"]`, (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }, q);
      await sleep(60);
    };

    // (a) 只列平均值那一筆、顯示簡名
    eq(await searchFor(0, '杏鮑'), ['杏鮑菇 菇類'], '搜「杏鮑」只剩一筆「杏鮑菇」（不再有大、中、小、平均值四筆）');
    const rice = await searchFor(0, '稉米');
    ok(rice.length >= 1 && rice[0].startsWith('稉米 '), `搜「稉米」第一筆就是「稉米」：${rice.join('、')}`);
    noneOf(rice, (t) => /台稉|台中|高雄|台南|台農|平均值/.test(t), '稉米的九個品種與「平均值」字樣都不列出來');
    const idxInfo = await page.evaluate(async () => {
      const store = await import('./js/store.js');
      const idx = store.foodsIndex();
      return { n: idx.list.length, small: idx.byId.get('G1300201')?.name, avg: idx.byId.get('G13002')?.name };
    });
    eq(idxInfo, { n: 2151, small: '杏鮑菇(大)', avg: '杏鮑菇平均值' }, '資料一筆都沒刪、編號沒改（杏鮑菇(大) 照樣查得到）');

    // (c) 選完自動換單位
    await searchFor(0, '杏鮑');
    await pickFirst(0);
    eq(await val(0, 'ingLabel'), '杏鮑菇', '選了之後名稱帶入簡名「杏鮑菇」（不是打到一半的「杏鮑」）');
    eq(await unitsOf(0), ['根', '克'], '杏鮑菇的單位：根（預設）、克');
    eq(await val(0, 'ingUnit'), '根', '預設用「根」');
    ok((await txt(0, 'ingGramsHint')).includes('1 根 ≈ 70 克'), `還沒填數量時講出一根大約幾克：「${await txt(0, 'ingGramsHint')}」`);
    await setQty(0, '2');
    ok((await txt(0, 'ingGramsHint')).includes('≈ 140 克'), `填 2 根 → 講出約 140 克：「${await txt(0, 'ingGramsHint')}」`);

    // (b) 改選別的食材，名稱跟著換
    await searchFor(0, '高麗菜');
    await pickFirst(0);
    eq(await val(0, 'ingLabel'), '高麗菜', '改選高麗菜 → 下面的名稱跟著變成「高麗菜」（以前會停在「杏鮑菇」）');
    ok((await txt(0, 'pickedFood')).includes('甘藍'), `對到的條目也換了：「${await txt(0, 'pickedFood')}」`);
    eq(await val(0, 'ingUnit'), '顆', '單位換成「顆」');
    eq(await val(0, 'ingQty'), '', '「2 根」對高麗菜沒有意義 → 數量清空重填（不是 0.14 顆）');
    // 2026-09-18 Yolin 定案：食材只有一個框（查詢＝輸入）。改框裡的字時保護對應關係。
    eq(await page.$$eval(`${row(0)} [data-field="foodSearch"]`, (els) => els.length), 0, '食材只剩一個框（沒有另一個「找食材」框）');
    const foodOf = (i) => page.evaluate(async (k) => {
      // 從畫面讀：存檔前的草稿不在 store 裡，用「營養照…算」那行＋清單標 on 的那筆
      const r = document.querySelector(`[data-ingredient="${k}"]`);
      return { hint: r.querySelector('[data-field="pickedFood"]').textContent, listShown: !r.querySelector('.picker-results').hidden };
    }, i);
    // 改成認不得的名稱 → 維持原本對到的（甘藍），下面寫「營養照『甘藍』算」，清單跳出來可以重選
    await searchFor(0, '高麗菜切絲');
    const kept = await foodOf(0);
    ok(kept.hint.includes('營養照「甘藍」算'), `改成認不得的「高麗菜切絲」→ 維持對到甘藍，下面寫：「${kept.hint}」`);
    ok(kept.listShown, '清單照樣跳出來，可以重新點選');
    eq(await val(0, 'ingUnit'), '顆', '對應沒變，單位也沒變（還是顆）');
    // 改成認得的名稱 → 自動改對到那一筆
    await searchFor(0, '杏鮑菇');
    ok((await foodOf(0)).hint.includes('營養照「杏鮑菇」算'), `改成認得的「杏鮑菇」→ 自動改對到杏鮑菇：「${(await foodOf(0)).hint}」`);
    eq(await val(0, 'ingUnit'), '根', '營養跟著換，單位也換成「根」');
    // 點清單另一筆 → 名稱當場換成那一筆（舊 bug：名稱停在上一樣）
    await searchFor(0, '青江');
    await pickFirst(0);
    eq(await val(0, 'ingLabel'), '青江菜', '點清單的青江菜 → 框裡的名稱當場換成「青江菜」（不會停在「杏鮑菇」）');
    ok((await foodOf(0)).hint.includes('青江菜'), '對應也換成青江菜');
    // 打字途中剛好認得的詞不會卡住：逐字打「豬耳朵」，打到「豬耳」會先對到，打完「豬耳朵」認不得就放掉（不會變成營養照豬耳算）
    // （這一段在下面「滷豬耳朵」照樣驗；這裡驗「離開框」之後才算數）
    await searchFor(0, '高麗菜');
    await page.$eval(`${row(0)} [data-field="ingLabel"]`, (el) => el.dispatchEvent(new Event('change', { bubbles: true })));
    // 回到後面要用的狀態：高麗菜 0.25 顆，名稱寫「高麗菜絲」
    await setQty(0, '0.25');
    await searchFor(0, '高麗菜絲');
    ok((await foodOf(0)).hint.includes('營養照「甘藍」算'), '名稱寫「高麗菜絲」，營養照甘藍算');
    // Yolin 舉的例子：打「傳統豆腐」（認得）、離開框，再改成「豆腐切塊」→ 維持傳統豆腐
    await clickEl(page, '[data-action="addIngredient"]');
    await sleep(120);
    const last = await page.$$eval('[data-list="ingredients"] .edit-row', (els) => els.length - 1);
    await page.type(`${row(last)} [data-field="ingLabel"]`, '傳統豆腐');
    await page.$eval(`${row(last)} [data-field="ingLabel"]`, (el) => el.dispatchEvent(new Event('change', { bubbles: true })));
    await searchFor(last, '豆腐切塊');
    const tofu = await foodOf(last);
    ok(tofu.hint.includes('營養照「傳統豆腐」算') && tofu.listShown, `「傳統豆腐」改成「豆腐切塊」→ 維持傳統豆腐、清單可重選：「${tofu.hint}」`);
    // 對照：新的一列，沒離開框就一路打下去（逐字打「雞蛋餅皮」會先經過認得的「雞蛋」）→ 不會卡在半途的詞
    await page.$eval(`${row(last)} button[aria-label^="移除食材"]`, (el) => el.click());
    await sleep(120);
    await clickEl(page, '[data-action="addIngredient"]');
    await sleep(120);
    await page.type(`${row(last)} [data-field="ingLabel"]`, '雞蛋');
    ok((await foodOf(last)).hint.includes('營養照「雞蛋'), `（前提）打到「雞蛋」時先對到雞蛋：「${(await foodOf(last)).hint}」`);
    await page.type(`${row(last)} [data-field="ingLabel"]`, '餅皮');
    ok((await foodOf(last)).hint.includes('查不到「雞蛋餅皮」'), `繼續打成「雞蛋餅皮」→ 放掉半途的雞蛋，照實講查不到：「${(await foodOf(last)).hint}」`);
    await page.$eval(`${row(last)} button[aria-label^="移除食材"]`, (el) => el.click()); // 移除這一列，後面的存檔斷言照舊四列
    await sleep(120);

    // 蛋用顆、醬油用大匙、肉可以用斤；換單位克數不變
    await clickEl(page, '[data-action="addIngredient"]');
    await sleep(120);
    await searchFor(1, '雞蛋');
    await pickFirst(1);
    eq(await val(1, 'ingUnit'), '顆', '雞蛋預設「顆」');
    await setQty(1, '3');
    ok((await txt(1, 'ingGramsHint')).includes('≈ 165 克'), `3 顆蛋 ≈ 165 克：「${await txt(1, 'ingGramsHint')}」`);
    await clickEl(page, '[data-action="addIngredient"]');
    await sleep(120);
    await searchFor(2, '醬油');
    await pickFirst(2);
    eq(await unitsOf(2), ['大匙', '小匙', '克'], '醬油：大匙、小匙、克');
    await setQty(2, '1');
    ok((await txt(2, 'ingGramsHint')).includes('≈ 18 克'), `1 大匙醬油 ≈ 18 克：「${await txt(2, 'ingGramsHint')}」`);
    await clickEl(page, '[data-action="addIngredient"]');
    await sleep(120);
    await searchFor(3, '豬絞肉');
    await pickFirst(3);
    ok((await unitsOf(3)).includes('斤') && (await unitsOf(3)).includes('克'), `豬絞肉可以用斤：${(await unitsOf(3)).join('、')}`);
    await page.select(`${row(3)} [data-field="ingUnit"]`, '斤');
    await setQty(3, '0.5');
    ok((await txt(3, 'ingGramsHint')).includes('≈ 300 克'), `半斤 ≈ 300 克：「${await txt(3, 'ingGramsHint')}」`);
    await page.select(`${row(3)} [data-field="ingUnit"]`, '克');
    await sleep(60);
    eq(await val(3, 'ingQty'), '300', '切回克 → 數量換成 300（克數不變）');

    await clickEl(page, '[data-action="addStep"]'); await sleep(80);
    await page.type('[data-list="steps"] textarea', '全部炒熟');
    await waitToastGone(page);
    await clickEl(page, '[data-action="saveRecipe"]');
    await titleIs(page, '單位測試菜');
    const savedU = await page.evaluate(async () => {
      const store = await import('./js/store.js');
      const r = store.userRecipes().find((x) => x.name === '單位測試菜');
      return { id: r.id, ings: r.ingredients.map((i) => ({ food: i.food, label: i.label, grams: i.grams, entry: i.entry ?? null })) };
    });
    eq(savedU.ings[0].food, 'E30001', '名稱寫「高麗菜絲」的那一列，存檔時對到甘藍（E30001）');
    eq(savedU.ings.map((i) => i.grams), [250, 165, 18, 300], '存的是克：高麗菜 0.25 顆＝250、蛋 3 顆＝165、醬油 1 大匙＝18、豬絞肉 300');
    eq(savedU.ings.map((i) => i.entry), [{ qty: 0.25, unit: '顆' }, { qty: 3, unit: '顆' }, { qty: 1, unit: '大匙' }, null], '也記下當初怎麼填的（用克填的就不另外記）');
    await page.waitForSelector('[data-card="recipeNutrition"] .nutri-value');
    const vals = await nutriValues(page);
    ok(vals.filter((v) => /^估 \d/.test(v.t)).length >= 10, '用顆、大匙填的食材照樣算得出營養估計');

    await goto(page, `#/recipes/${savedU.id}/edit`);
    await titleIs(page, '修改食譜');
    await page.waitForSelector(`${row(1)} [data-field="ingQty"]`);
    eq([await val(1, 'ingQty'), await val(1, 'ingUnit')], ['3', '顆'], '再打開編輯：蛋還是顯示「3 顆」');
    eq([await val(2, 'ingQty'), await val(2, 'ingUnit')], ['1', '大匙'], '醬油還是「1 大匙」');
    eq([await val(3, 'ingQty'), await val(3, 'ingUnit')], ['300', '克'], '用克填的顯示克');
    // 後面的段落會數「我的食譜有幾道」：這道只是單位測試用，刪掉
    await page.evaluate(async (id) => (await import('./js/store.js')).deleteUserRecipe(id), savedU.id);
    await goto(page, '#/recipes');
    await titleIs(page, '食譜');
  }

  section('複製內建食譜成我的版本');
  await goto(page, '#/recipes/new?from=r-tomato-egg');
  await titleIs(page, '新增食譜');
  await page.waitForSelector('[data-field="recipeName"]');
  eq(await page.$eval('[data-field="recipeName"]', (el) => el.value), '番茄炒蛋（我的版本）', '名稱帶「（我的版本）」');
  eq(await page.$$eval('[data-list="ingredients"] .edit-row', (els) => els.length), byId.get('r-tomato-egg').ingredients.length, '食材列數跟原食譜一樣');
  await waitToastGone(page);
  await clickEl(page, '[data-action="saveRecipe"]');
  await titleIs(page, '番茄炒蛋（我的版本）');
  await page.waitForSelector('[data-card="recipeNutrition"] .nutri-value');
  const copyKcal = (await nutriValues(page)).find((v) => v.k === 'kcal').t;
  await goto(page, '#/recipes/r-tomato-egg');
  await titleIs(page, '番茄炒蛋');
  await page.waitForSelector('[data-card="recipeNutrition"] .nutri-value');
  const origKcal = (await nutriValues(page)).find((v) => v.k === 'kcal').t;
  eq(copyKcal, origKcal, `複製版的每份熱量跟原版一樣（${origKcal}）`);

  section('「我的」篩選與刪除');
  await goto(page, '#/recipes');
  await titleIs(page, '食譜');
  await page.waitForSelector('[data-filter="mine"]');
  await clickEl(page, '[data-filter="mine"]');
  await sleep(100);
  const mine = await rowIds(page);
  eq(mine.length, 2, '「我的」有兩道');
  everyOf(mine, (id) => /^r-user-/.test(id), '都是使用者食譜');
  await goto(page, `#/recipes/${mineId}`);
  await titleIs(page, '我的燙青菜');
  await waitToastGone(page);
  await clickEl(page, '[data-action="deleteRecipe"]');
  await page.waitForSelector('.modal-card .btn-danger');
  await clickEl(page, '.modal-card .btn-danger');
  await titleIs(page, '食譜');
  eq(await page.evaluate(async () => (await import('./js/store.js')).userRecipes().length), 1, '刪掉一道後剩一道');

  section('現成的滷雞腳：1 步、0 分鐘、直接打食材名稱（沒點清單）也存得進去');
  {
    // 2026-09-14 使用者回報（v0.12.0 承諾過、後來又壞掉）：「滷雞腳」被「≥1 分鐘」「至少 3 步」「找不到「」」擋下。
    // 以前這條只在 recipetest 用「測試自己帶放寬旗標」驗過；真實的表單路徑（表單 → store.saveUserRecipe）
    // 從沒用 1 步、0 分鐘、沒點清單的食材走過 —— 把 store 的旗標拿掉，這支測試照樣綠（實測過）。
    await goto(page, '#/recipes/new');
    await titleIs(page, '新增食譜');
    await page.waitForSelector('[data-field="recipeName"]');
    await page.type('[data-field="recipeName"]', '滷雞腳');
    await clickEl(page, chipSel('vegMode', 'meatOnly'));
    await sleep(150);
    await page.$eval('[data-field="time"]', (el) => { el.value = '0'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.type('[data-ingredient="0"] [data-field="ingLabel"]', '雞腳');
    await sleep(150);
    const hint = await textOf(page, '[data-ingredient="0"] [data-field="pickedFood"]');
    ok(hint.includes('雞腳(肉雞)'), `沒點清單、直接打「雞腳」→ 表單就講出會對到哪一筆：「${hint}」`);
    await clickEl(page, '[data-action="addIngredient"]');
    await sleep(150);
    await page.type('[data-ingredient="1"] [data-field="ingLabel"]', '青蔥');   // 打了認得的名稱，但沒點清單
    await clickEl(page, '[data-action="addStep"]'); await sleep(80);
    await page.type('[data-list="steps"] textarea', '加熱');
    await waitToastGone(page);
    await clickEl(page, '[data-action="saveRecipe"]');
    await titleIs(page, '滷雞腳');
    const saved = await page.evaluate(async () => {
      const s = await import('./js/store.js');
      const r = s.userRecipes().find((x) => x.name === '滷雞腳');
      return r ? { time: r.time, steps: r.steps.length, foods: r.ingredients.map((i) => i.food), labels: r.ingredients.map((i) => i.label), tags: r.tags } : null;
    });
    ok(saved, '存進去了，而且跳到這道菜的頁面');
    eq(saved.time, 0, '時間就是 0（現成的）');
    eq(saved.steps, 1, '步驟就是 1 步');
    eq(saved.foods, ['I0420801', 'E23001'], `直接打的「雞腳」、打在搜尋框沒點的「青蔥」都解析到編號（${saved.labels.join('、')}）`);
    ok(saved.tags.includes('meat'), '雞腳被認成肉 → 標成「葷」不會被擋');
    ok((await textOf(page, '#view')).includes('現成的'), '0 分鐘顯示成「現成的」');

    // 2026-09-14 再回報：「還是強制要求輸入步驟」—— 上面那道打了「加熱」；使用者連那一步都不想寫（表單卡「步驟 #1 還沒寫字」）。
    // 走真實表單：步驟那一格完全不碰，直接按新增。
    await goto(page, '#/recipes/new');
    await titleIs(page, '新增食譜');
    await page.waitForSelector('[data-field="recipeName"]');
    await page.type('[data-field="recipeName"]', '滷雞腳不寫步驟');
    await clickEl(page, chipSel('vegMode', 'meatOnly'));
    await sleep(150);
    await page.$eval('[data-field="time"]', (el) => { el.value = '0'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.type('[data-ingredient="0"] [data-field="ingLabel"]', '雞腳');
    await sleep(150);
    eq(await page.$$eval('[data-list="steps"] textarea', (els) => els.length), 0, '（前提）預設 0 步，一步都沒加');
    await waitToastGone(page);
    await clickEl(page, '[data-action="saveRecipe"]');
    await page.waitForFunction(() => document.getElementById('topTitle')?.textContent === '滷雞腳不寫步驟' || document.querySelector('[data-field="errors"]')?.hidden === false);
    const stepErrs = await page.$eval('[data-field="errors"]', (el) => (el.hidden ? '' : el.textContent)).catch(() => '');
    eq(await textOf(page, '#topTitle'), '滷雞腳不寫步驟', `步驟一個字都沒打，照樣存得進去（${stepErrs || '沒有錯誤'}）`);
    const noSteps = await page.evaluate(async () => (await import('./js/store.js')).userRecipes().find((x) => x.name === '滷雞腳不寫步驟')?.steps.map((s) => s.text));
    eq(noSteps, ['現成的，加熱或直接盛盤即可'], `存成預設那一句（${JSON.stringify(noSteps)}）`);
    ok((await textOf(page, '[data-card="recipeSteps"]')).includes('現成的，加熱或直接盛盤即可'), '食譜頁的步驟顯示那一句，不是空的一格');
    await page.evaluate(async () => { const s = await import('./js/store.js'); const r = s.userRecipes().find((x) => x.name === '滷雞腳不寫步驟'); if (r) await s.deleteUserRecipe(r.id); });

    // 真的查不到的食材：訊息要把使用者打的字帶進去，不可以是「找不到「」」
    await goto(page, '#/recipes/new');
    await titleIs(page, '新增食譜');
    await page.waitForSelector('[data-field="recipeName"]');
    await page.type('[data-field="recipeName"]', '神祕小菜');
    await page.type('[data-ingredient="0"] [data-field="ingLabel"]', '豬耳朵絲');
    await clickEl(page, '[data-action="addStep"]'); await sleep(80);
    await page.type('[data-list="steps"] textarea', '上桌');
    await waitToastGone(page);
    await clickEl(page, '[data-action="saveRecipe"]');
    await page.waitForSelector('[data-field="errors"]:not([hidden]) li');
    const errs = await page.$$eval('[data-field="errors"] li', (els) => els.map((e) => e.textContent));
    // 查不到的食材現在可以存，但要自己選葷素 —— 訊息照樣要帶入使用者打的名稱
    ok(errs.some((e) => e.includes('豬耳朵絲')), `訊息帶入使用者打的名稱：「${errs.find((e) => e.includes('豬耳朵絲')) ?? errs.join('｜')}」`);
    noneOf(errs, (e) => e.includes('「」'), '沒有任何一則是空的引號');
    noneOf(errs, (e) => /3 步|≥1|還沒寫字/.test(e), '使用者自己加的菜不會出現「至少 3 步」「≥1 分鐘」「還沒寫字」');
  }

  section('查不到的食材（豬耳朵）也存得進去，但葷素要自己選、畫面講明只是部分估算');
  {
    // 2026-09-14 使用者確認：查不到的食材讓使用者存；紅線是**葷素要使用者自己明講**（表單預設是「素」，不能沿用）。
    // 上一段停在「新增食譜」而且沒存；網址一樣的話表單不會重畫，打的字會接在舊的後面 —— 先離開再回來。
    await goto(page, '#/recipes');
    await titleIs(page, '食譜');
    await goto(page, '#/recipes/new');
    await titleIs(page, '新增食譜');
    await page.waitForSelector('[data-field="recipeName"]');
    await page.type('[data-field="recipeName"]', '滷豬耳朵');
    await page.$eval('[data-field="time"]', (el) => { el.value = '0'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.type('[data-ingredient="0"] [data-field="ingLabel"]', '豬耳朵');
    await page.select('[data-ingredient="0"] [data-field="ingUnit"]', '克');
    await page.type('[data-ingredient="0"] [data-field="ingQty"]', '300');
    await sleep(150);
    const earHint = await textOf(page, '[data-ingredient="0"] [data-field="pickedFood"]');
    ok(earHint.includes('查不到「豬耳朵」') && earHint.includes('未估算'), `打了查不到的名稱 → 表單當場講可以存、營養會寫未估算：「${earHint}」`);
    const box = await page.$eval('[data-field="vegConfirm"]', (el) => ({ hidden: el.hidden, text: el.textContent, buttons: el.querySelectorAll('[data-action="confirmVeg"]').length }));
    ok(!box.hidden && box.text.includes('豬耳朵') && box.text.includes('自己選一次') && box.buttons === 3, `還沒自己選葷素 → 出現提醒與三顆按鈕：「${box.text.slice(0, 60)}」`);
    await clickEl(page, '[data-action="addIngredient"]');
    await sleep(150);
    await page.type('[data-ingredient="1"] [data-field="ingLabel"]', '青蔥');
    await page.select('[data-ingredient="1"] [data-field="ingUnit"]', '克');
    await page.type('[data-ingredient="1"] [data-field="ingQty"]', '20');
    // 加一個食材會整排重畫：第一列的提示不可以變回「尚未選食材」（線上實測抓到過）
    const hintAfterAdd = await textOf(page, '[data-ingredient="0"] [data-field="pickedFood"]');
    ok(hintAfterAdd.includes('查不到「豬耳朵」'), `加了第二個食材（整排重畫）之後，第一列的提示還在：「${hintAfterAdd}」`);
    await clickEl(page, '[data-action="addStep"]'); await sleep(80);
    await page.type('[data-list="steps"] textarea', '切片上桌');
    await waitToastGone(page);
    await clickEl(page, '[data-action="saveRecipe"]');
    await page.waitForSelector('[data-field="errors"]:not([hidden]) li');
    const errs1 = await page.$$eval('[data-field="errors"] li', (els) => els.map((e) => e.textContent));
    ok(errs1.some((e) => e.includes('自己選一次')), `沒選葷素就按新增 → 擋下：${errs1.join('｜')}`);
    eq(await page.evaluate(() => document.getElementById('topTitle')?.textContent), '新增食譜', '沒有存進去（還在新增食譜）');
    await clickEl(page, '[data-action="confirmVeg"][data-value="meatOnly"]');
    await sleep(150);
    eq(await page.$eval('[data-field="vegConfirm"]', (el) => el.hidden), true, '自己選了之後，提醒收起來');
    eq(await page.$eval('[data-chips="vegMode"] .chip.on', (el) => el.dataset.value), 'meatOnly', '「素葷」那排也跟著變成葷');
    await waitToastGone(page);
    await clickEl(page, '[data-action="saveRecipe"]');
    await titleIs(page, '滷豬耳朵');
    const saved = await page.evaluate(async () => {
      const s = await import('./js/store.js');
      const r = s.userRecipes().find((x) => x.name === '滷豬耳朵');
      return r ? { id: r.id, ing: r.ingredients.map((i) => ({ food: i.food, unresolved: !!i.unresolved })), confirmed: r.vegModeConfirmed, tags: r.tags } : null;
    });
    ok(saved, '存進去了');
    eq(saved.ing, [{ food: null, unresolved: true }, { food: 'E23001', unresolved: false }], '豬耳朵存成查不到、青蔥照常解析');
    ok(saved.confirmed === true && saved.tags.includes('unresolved'), '記住使用者自己選過葷素，並標上 unresolved');
    await page.waitForSelector('[data-field="unresolvedNotice"]');
    const notice = await textOf(page, '[data-field="unresolvedNotice"]');
    ok(notice.includes('豬耳朵') && notice.includes('部分估算'), `食譜頁講明查不到、只是部分估算：「${notice}」`);
    const kcal = await page.$eval('[data-card="recipeNutrition"] .nutri-value[data-nutrient="kcal"]', (el) => ({ t: el.textContent, partial: el.dataset.partial }));
    ok(kcal.partial === '1' && kcal.t.includes('＊'), `熱量標了＊（${kcal.t}）—— 不會讓人以為數字是完整的`);
    await goto(page, '#/recipes');
    await titleIs(page, '食譜');
    await page.waitForSelector(`[data-recipe="${saved.id}"]`);
    ok((await textOf(page, `[data-recipe="${saved.id}"]`)).includes('部分估算'), '食譜清單上這道標「部分估算」');
  }

  eq(pageErrors, [], '整個流程沒有未攔截的例外');
} finally {
  await close();
}
done('recipeviewtest');

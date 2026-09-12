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

  section('清單與篩選');
  await goto(page, '#/recipes');
  await titleIs(page, '食譜');
  await page.waitForSelector('[data-list="recipes"] a.row');
  const all = await rowIds(page);
  ok(all.length >= 36, `全部 ${all.length} 道`);
  await clickEl(page, '[data-filter="veg"]');
  await sleep(100);
  const vegRows = await rowIds(page);
  ok(vegRows.length >= 8 && vegRows.length < all.length, `（母體）素 ${vegRows.length} 道`);
  everyOf(vegRows, (id) => byId.get(id)?.vegMode === 'nativeVeg', '「素」篩選後每一道都是 nativeVeg');
  await clickEl(page, '[data-filter="quick"]');
  await sleep(100);
  const quickVeg = await rowIds(page);
  ok(quickVeg.length >= 3, `（母體）素＋20 分內 ${quickVeg.length} 道`);
  everyOf(quickVeg, (id) => byId.get(id).vegMode === 'nativeVeg' && byId.get(id).time <= 20, '兩個篩選是 AND');
  await clickEl(page, '[data-filter="quick"]');
  await clickEl(page, '[data-filter="all"]');
  await sleep(100);

  section('誰要吃：全素不含五辛');
  await page.select('[data-field="eater"]', 'diet:veganNoAllium');
  await sleep(150);
  const noAllium = await rowIds(page);
  const expected = recipes.filter((r) => fitsDiet(r, 'veganNoAllium')).map((r) => r.id).sort();
  ok(expected.length >= 5 && expected.length < recipes.length, `（母體）依資料應有 ${expected.length} 道可吃，池子共 ${recipes.length}`);
  eq([...noAllium].sort(), expected, '清單剛好是資料算出來「全素不含五辛可吃」的那幾道');
  const tagged = recipes.filter((r) => (r.vegMode === 'splittable' ? r.vegTags : r.tags).some((t) => ['meat', 'seafood', 'egg', 'dairy', 'allium'].includes(t)) && !r.alliumOptional).map((r) => r.id);
  ok(tagged.length >= 15, `（對照母體）${tagged.length} 道帶葷／蛋／奶／五辛（不可省略）`);
  noneOf(tagged, (id) => noAllium.includes(id), '那些都不在清單裡');
  await page.select('[data-field="eater"]', '');

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
  const howText = await textOf(page, '[data-card="recipeNutrition"] details.how');
  ok(howText.includes('食品藥物管理署') && howText.includes('未計烹調'), '「怎麼算的」有食藥署來源與「未計烹調」');
  ok(howText.includes('→ 甘藍平均值'), '「怎麼算的」列出對到的食藥署條目');
  ok(!/份醣|醣類份數|份的醣/.test(await textOf(page, '#view')), '沒有出現醣類份數（尚無可引用來源，不顯示）');

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
  await page.type('[data-field="recipeName"]', '我的燙青菜');
  await page.type('[data-ingredient="0"] [data-field="foodSearch"]', '青江菜');
  await page.waitForSelector('[data-ingredient="0"] .picker-item');
  await clickEl(page, '[data-ingredient="0"] .picker-item');
  await sleep(100);
  ok((await textOf(page, '[data-ingredient="0"] [data-field="pickedFood"]')).includes('青江菜'), '選到青江菜的條目');
  const stepAreas = await page.$$('[data-list="steps"] textarea');
  eq(stepAreas.length, 3, '預設三步');
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
  await page.waitForSelector('[data-ingredient="0"] [data-field="ingGrams"]');
  await page.type('[data-ingredient="0"] [data-field="ingGrams"]', '200');
  await waitToastGone(page);
  await clickEl(page, '[data-action="saveRecipe"]');
  await titleIs(page, '我的燙青菜');
  await page.waitForSelector('[data-card="recipeNutrition"] .nutri-value');
  const mineVals2 = await nutriValues(page);
  const kcal = mineVals2.find((v) => v.k === 'kcal').t;
  ok(/^估 \d/.test(kcal), `熱量有估計值：${kcal}`);

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

  eq(pageErrors, [], '整個流程沒有未攔截的例外');
} finally {
  await close();
}
done('recipeviewtest');

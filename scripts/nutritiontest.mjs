// 營養估算（npm run nutritiontest）。
//
// 守的事：
//   · 固定食譜（白飯 200 g ＋ 雞蛋 50 g ＋ 醬油 10 g）的估算等於用 foods.json 的值手算（期望值由測試自己算，不寫死）
//   · 素版不含任何 meat 軌食材；葷版不含 veg 軌；兩版不相加
//   · 資料庫的 null 不計入、不當 0；全部沒值 → null；部分沒值 → 部分和＋partial 名單
//   · 克數缺 → 整個食材不計入，列在 missingGrams
//   · 每人一份 ＝ 共用軌 ÷ 總份數 ＋ 版本軌 ÷ 版本份數；總量 ＝ 每份 × 顯示份數

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ok, eq, near, section, done, everyOf, noneOf, detects } from './tap.mjs';
import { indexFoods, resolveFood, NUTRIENT_ORDER } from '../js/foods.js';
import { estimate, scaleNutrient, servingsFor, tracksFor } from '../js/nutrition.js';
import { validateRecipe } from '../js/recipeschema.js';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const foods = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/foods.json'), 'utf8'));
const aliases = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/aliases.json'), 'utf8'));
const foodtags = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/foodtags.json'), 'utf8'));
const idx = indexFoods(foods, aliases);
const ctx = { resolve: (t) => resolveFood(t, idx), foodTags: foodtags.tags };
const normalize = (raw, extra = {}) => {
  const { errors, recipe } = validateRecipe(raw, { ...ctx, ...extra });
  if (errors.length) throw new Error(`fixture 本身沒過驗證：${errors.join('；')}`);
  return recipe;
};
const round1 = (x) => Math.round(x * 10) / 10;

section('小工具');
eq(scaleNutrient(183, 200), 366, '每 100 克 183 × 200 克 → 366');
eq(scaleNutrient(null, 200), null, '資料庫 null → null');
eq(scaleNutrient(0, 200), 0, '（對照）真的 0 → 0，跟 null 分得開');
eq(scaleNutrient(183, 0), null, '克數 0 → null');

section('固定食譜：白飯 200 g ＋ 雞蛋 50 g ＋ 醬油 10 g（2 人份）');
const fixture = normalize({
  id: 'r-test-fixture', name: '測試用', role: 'main', servings: 2, time: 5, method: 'boil', vegMode: 'nativeVeg', texture: 'normal', season: [],
  ingredients: [
    { food: '白飯', label: '白飯', grams: 200 },
    { food: '雞蛋', label: '雞蛋', grams: 50 },
    { food: '醬油', label: '醬油', grams: 10, pantry: true },
  ],
  steps: [{ text: '第一步驟' }, { text: '第二步驟' }, { text: '第三步驟' }],
});
const rice = resolveFood('白飯', idx);
const egg = resolveFood('雞蛋', idx);
const soy = resolveFood('醬油', idx);
ok(rice && egg && soy, '（母體）三個食材都解析到');
const est = estimate(fixture, idx);
eq(est.servings, 2, '預設顯示 2 人份');
eq(est.rows.length, 3, '三個食材都計入');
// 期望值由 foods.json 的值算出來，不寫死數字
for (const k of ['kcal', 'protein', 'carb', 'sodium', 'potassium']) {
  const parts = [[rice, 200], [egg, 50], [soy, 10]].map(([f, g]) => (f.n[k] == null ? null : f.n[k] * g / 100));
  const known = parts.filter((p) => p != null);
  const expectedPer = known.length ? known.reduce((a, b) => a + b, 0) / 2 : null;
  if (expectedPer == null) { eq(est.perServing[k], null, `${k}：三個食材都沒值 → null`); continue; }
  near(est.perServing[k], expectedPer, 0.05, `${k} 每人一份 ≈ ${round1(expectedPer)}（手算：(${parts.map((p) => (p == null ? 'null' : round1(p))).join(' + ')}) ÷ 2）`);
  near(est.total[k], expectedPer * 2, 0.1, `${k} 兩人份總量 ＝ 每份 × 2`);
}
ok(est.perServing.kcal > 200 && est.perServing.kcal < 400, `熱量每份 ${round1(est.perServing.kcal)} kcal 在合理範圍`);
eq(est.missingGrams, [], '沒有缺克數的食材');
eq(est.unresolved, [], '沒有對不到的食材');

section('null 不計入、不當 0');
// 白飯的糖質總量在食藥署資料庫是 null（datatest 驗過）；醬油有值。所以「糖」是部分和。
eq(rice.n.sugar, null, '（前提）白飯的糖質總量在資料庫是 null');
ok(soy.n.sugar != null || egg.n.sugar != null, '（前提）雞蛋或醬油的糖有值', JSON.stringify({ egg: egg.n.sugar, soy: soy.n.sugar }));
ok(est.partial.sugar.includes('白飯'), `糖：白飯列在 partial（沒計入）：${JSON.stringify(est.partial.sugar)}`);
const sugarKnown = [[egg, 50], [soy, 10]].filter(([f]) => f.n.sugar != null).map(([f, g]) => f.n.sugar * g / 100);
near(est.perServing.sugar, sugarKnown.reduce((a, b) => a + b, 0) / 2, 0.05, '糖的部分和只含有值的食材，白飯不是被當成 0 加進去（結果一樣是因為加 0；但 partial 名單證明它被標記了）');
// 一道全部食材某欄位都 null 的菜：那欄要是 null，不是 0
const allNullKeys = NUTRIENT_ORDER.filter((k) => rice.n[k] == null);
ok(allNullKeys.length >= 1, `（母體）白飯有 ${allNullKeys.length} 個欄位是 null：${allNullKeys.join('、')}`);
const riceOnly = normalize({ ...fixture, id: 'r-test-rice', ingredients: [{ food: '白飯', label: '白飯', grams: 200 }] });
const estRice = estimate(riceOnly, idx);
everyOf(allNullKeys, (k) => estRice.perServing[k] === null && estRice.total[k] === null, '只有白飯的菜，白飯沒值的欄位是 null（不是 0）');
everyOf(allNullKeys, (k) => estRice.partial[k].length === 0, '全部都沒值時不叫 partial（沒東西可以「部分」）');
noneOf(NUTRIENT_ORDER.filter((k) => rice.n[k] != null), (k) => estRice.perServing[k] == null, '（對照）白飯有值的欄位都算得出來');

section('克數缺 → 整個食材不計入，列在 missingGrams');
const userRecipe = normalize({
  ...fixture, id: 'r-user-test', source: 'user',
  ingredients: [{ food: '白飯', label: '白飯', grams: 200 }, { food: '雞蛋', label: '雞蛋（沒填克數）', grams: null }],
}, { allowMissingGrams: true });
const estUser = estimate(userRecipe, idx);
eq(estUser.missingGrams, ['雞蛋（沒填克數）'], '沒填克數的雞蛋列在 missingGrams');
eq(estUser.rows.map((r) => r.label), ['白飯'], '計算列裡只有白飯');
near(estUser.perServing.kcal, rice.n.kcal * 200 / 100 / 2, 0.05, '熱量只有白飯的份，雞蛋沒有被當 0 克或 50 克算進去');
const { errors: builtinErr } = validateRecipe({ ...userRecipe, source: 'builtin' }, ctx);
ok(builtinErr.some((e) => /grams/.test(e)), '（對照）同一道菜當內建食譜驗，缺克數會被擋下');

section('素版／葷版分開，永遠不相加');
const recipes = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/recipes.json'), 'utf8')).recipes;
const split = recipes.filter((r) => r.vegMode === 'splittable');
ok(split.length >= 8, `（母體）${split.length} 道可分流`);
for (const r of split) {
  const veg = estimate(r, idx, { version: 'veg' });
  const meat = estimate(r, idx, { version: 'meat' });
  const meatLabels = r.ingredients.filter((i) => i.track === 'meat').map((i) => i.label);
  const vegLabels = r.ingredients.filter((i) => i.track === 'veg').map((i) => i.label);
  ok(veg.rows.every((row) => !meatLabels.includes(row.label)) && veg.rows.some((row) => vegLabels.includes(row.label)),
    `${r.name}：素版沒有任何 meat 軌食材、有 veg 軌食材`);
  ok(meat.rows.every((row) => !vegLabels.includes(row.label)) && meat.rows.some((row) => meatLabels.includes(row.label)),
    `${r.name}：葷版沒有任何 veg 軌食材、有 meat 軌食材`);
}
// 用一道刻意極端的菜證明兩版真的分開：meat 軌放一個鈉極高的食材，素版的鈉不能動
const salty = normalize({
  id: 'r-test-split', name: '分流測試', role: 'main', servings: 4, splitServings: { veg: 1, meat: 3 }, time: 5, method: 'stirfry', vegMode: 'splittable', texture: 'normal', season: [],
  ingredients: [
    { food: '高麗菜', label: '高麗菜', grams: 400, track: 'base' },
    { food: '乾香菇', label: '乾香菇', grams: 10, track: 'veg' },
    { food: '豬肉片', label: '豬肉片', grams: 300, track: 'meat' },
    { food: '鹽', label: '鹽（只放葷鍋）', grams: 30, track: 'meat', pantry: true },
  ],
  steps: [{ stage: 'base', text: '共同備料' }, { stage: 'split', type: 'split', text: '盛出素食份' }, { stage: 'veg', text: '素鍋收尾' }, { stage: 'meat', text: '葷鍋收尾' }],
});
const cab = resolveFood('高麗菜', idx);
const mush = resolveFood('乾香菇', idx);
const salt = resolveFood('鹽', idx);
const sVeg = estimate(salty, idx, { version: 'veg' });
const sMeat = estimate(salty, idx, { version: 'meat' });
const expectVegSodium = cab.n.sodium * 400 / 100 / 4 + mush.n.sodium * 10 / 100 / 1;
near(sVeg.perServing.sodium, expectVegSodium, 0.05, `素版每份鈉 ＝ 高麗菜 ÷ 4 ＋ 乾香菇 ÷ 1 ＝ ${round1(expectVegSodium)} mg，30 克鹽完全不在裡面`);
ok(sMeat.perServing.sodium > sVeg.perServing.sodium * 20, `葷版每份鈉 ${round1(sMeat.perServing.sodium)} mg 遠高於素版（鹽只在葷鍋）`);
ok(salt.n.sodium > 10000, `（前提）鹽的鈉每 100 克 ${salt.n.sodium} mg`);
eq(sVeg.versionServings, 1, '素版份數 1');
eq(sMeat.versionServings, 3, '葷版份數 3');
eq(tracksFor(salty, 'veg'), ['base', 'veg'], '素版的軌');
eq(tracksFor(salty, 'meat'), ['base', 'meat'], '葷版的軌');
eq(servingsFor(fixture, 'all'), 2, '不分流的菜份數就是 servings');

section('顯示份數縮放');
const est6 = estimate(fixture, idx, { servings: 6 });
near(est6.perServing.kcal, est.perServing.kcal, 1e-9, '改成 6 人份：每份不變');
near(est6.total.kcal, est.perServing.kcal * 6, 1e-6, '總量 ＝ 每份 × 6');
near(est6.rows[0].grams, 200 / 2 * 6, 1e-9, '食材克數跟著變成 6 人份（白飯 600 g）');

section('對照組：一個把 null 當 0 的壞估算法會給出不一樣的 partial');
detects((fn) => fn(riceOnly, idx).partial.sugar.length === 0 && fn(riceOnly, idx).perServing.sugar === null, {
  shouldHit: [estimate],
  shouldMiss: [(r, i) => ({ ...estimate(r, i), perServing: { ...estimate(r, i).perServing, sugar: 0 } })],
}, '「全部沒值 → null」這條分得出對的估算法與「當 0」的壞估算法');

done('nutritiontest');

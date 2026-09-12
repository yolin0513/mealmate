// 營養估算（PLAN §1.2、§3.2）。**純函式、不碰 DOM**，測試在 Node 直接 import。
//
// 規則（每一條都有測試與突變盯著）：
//   · 食材克數 × 食藥署「每 100 克含量」累加；資料庫的值是 null 就**不計入**，不是當 0
//   · 每人一份 ＝ 共用軌 ÷ 這道菜的總份數 ＋ 該版本軌 ÷ 該版本份數
//     素版 ＝ base ＋ veg、葷版 ＝ base ＋ meat；**兩版永遠不相加**
//   · 某個欄位所有食材都沒值 → null（畫面顯示「未估算」）；只有部分食材沒值 → 給出部分和，
//     並在 partial 裡列出沒計入的食材，畫面要標「有 N 項未計入」
//   · 克數缺（使用者手動食譜可以不填）→ 該食材整個不計入，列在 missingGrams
//   · 這是估計值：未計烹調吸油、水分變化與品項差異 —— 畫面每個數字前都有「估」

import { NUTRIENT_ORDER } from './foods.js';

export function emptyTotals() {
  return Object.fromEntries(NUTRIENT_ORDER.map((k) => [k, null]));
}

/** 每 100 克含量 × 克數 ÷ 100；值為 null 就回 null。 */
export function scaleNutrient(per100, grams) {
  if (per100 == null || !Number.isFinite(per100)) return null;
  if (!(grams > 0)) return null;
  return per100 * grams / 100;
}

/** 這個版本用到哪些軌。 */
export function tracksFor(recipe, version) {
  if (recipe.vegMode !== 'splittable') return ['base'];
  if (version === 'veg') return ['base', 'veg'];
  if (version === 'meat') return ['base', 'meat'];
  throw new Error(`可分流的菜要指定版本 veg 或 meat，收到 ${version}`);
}

/** 這個版本的份數（可分流的菜用 splitServings；否則用 servings）。 */
export function servingsFor(recipe, version) {
  if (recipe.vegMode !== 'splittable') return recipe.servings;
  return version === 'veg' ? recipe.splitServings.veg : recipe.splitServings.meat;
}

/**
 * 估算一道菜某個版本的營養。
 * @param recipe 正規化後的食譜（food 是整合編號）
 * @param idx    foods 索引（indexFoods 的結果）
 * @param version 'all'（不分流）| 'veg' | 'meat'
 * @param servings 要顯示幾人份的總量（預設＝該版本原本的份數）
 * @returns {{
 *   version, versionServings, servings,
 *   perServing: {key: number|null}, total: {key: number|null},
 *   rows: [{label, foodId, foodName, gramsPerServing, grams, per: {key: number|null}, missing: string[]}],
 *   partial: {key: string[]},      // 這個欄位有值，但這些食材沒計入（資料庫無此值）
 *   missingGrams: string[],        // 克數缺、整個不計入的食材
 *   unresolved: string[],          // 對不到食藥署編號的食材
 * }}
 */
export function estimate(recipe, idx, { version = 'all', servings = null } = {}) {
  const v = recipe.vegMode === 'splittable' ? (version === 'all' ? 'meat' : version) : 'all';
  const tracks = tracksFor(recipe, v);
  const versionServings = servingsFor(recipe, v);
  const n = servings ?? versionServings;

  const perServing = emptyTotals();
  const counted = Object.fromEntries(NUTRIENT_ORDER.map((k) => [k, 0]));
  const partial = Object.fromEntries(NUTRIENT_ORDER.map((k) => [k, []]));
  const missingGrams = [];
  const unresolved = [];
  const rows = [];

  for (const ing of recipe.ingredients) {
    if (!tracks.includes(ing.track ?? 'base')) continue;
    const divisor = (ing.track ?? 'base') === 'base' ? recipe.servings : versionServings;
    const food = idx.byId.get(ing.food);
    if (!food) { unresolved.push(ing.label); continue; }
    if (ing.grams == null) { missingGrams.push(ing.label); continue; }
    const gramsPerServing = ing.grams / divisor;
    const per = emptyTotals();
    const missing = [];
    for (const k of NUTRIENT_ORDER) {
      const val = scaleNutrient(food.n[k], gramsPerServing);
      per[k] = val;
      if (val == null) { missing.push(k); partial[k].push(ing.label); continue; }
      perServing[k] = (perServing[k] ?? 0) + val;
      counted[k] += 1;
    }
    rows.push({ label: ing.label, foodId: food.id, foodName: food.name, gramsPerServing, grams: gramsPerServing * n, per, missing, track: ing.track ?? 'base' });
  }

  // 只有部分食材沒值才叫 partial；全部沒值就是 null（沒東西可以「部分」）
  for (const k of NUTRIENT_ORDER) {
    if (counted[k] === 0) { perServing[k] = null; partial[k] = []; }
  }
  const total = emptyTotals();
  for (const k of NUTRIENT_ORDER) total[k] = perServing[k] == null ? null : perServing[k] * n;

  return { version: v, versionServings, servings: n, perServing, total, rows, partial, missingGrams, unresolved };
}

/** 幾位小數：熱量與毫克級整數、克級一位。 */
export function digitsFor(unit) {
  return unit === 'g' ? 1 : 0;
}

// 食材資料（data/foods.json ＋ data/aliases.json）的查詢。**純函式、不碰 DOM**，
// 測試在 Node 直接 import。
//
// 解析口語詞的規則（FEASIBILITY §1.3）：**精確比對**，不用子字串。
//   1. 本來就是整合編號 → 直接查
//   2. 別名表（data/aliases.json：口語詞 → 編號）
//   3. 樣品名稱完全相等
//   4. 俗名欄有一個完全相等
// 子字串搜尋只用在使用者打字找食材的畫面（searchFoods），而且排在精確命中之後。
// 搜「豬」會撈到「馬齒莧（俗名豬母乳）」、搜「雞」會撈到「鷹嘴豆」——那是搜尋，不是解析。

export function indexFoods(foodsJson, aliasesJson) {
  const list = foodsJson.foods;
  const byId = new Map(list.map((f) => [f.id, f]));
  const byName = new Map();
  const byAlias = new Map();
  for (const f of list) {
    if (!byName.has(f.name)) byName.set(f.name, f);
    for (const a of f.aliases) if (!byAlias.has(a)) byAlias.set(a, f);
  }
  const aliasMap = new Map(Object.entries(aliasesJson?.aliases ?? {}));
  return { list, byId, byName, byAlias, aliasMap, version: foodsJson.version, units: foodsJson.units, source: foodsJson.source };
}

/** 口語詞或編號 → 食材；解析不到回 null（不會回「最像的」）。 */
export function resolveFood(term, idx) {
  const t = String(term ?? '').trim();
  if (!t) return null;
  if (idx.byId.has(t)) return idx.byId.get(t);
  const viaAlias = idx.aliasMap.get(t);
  if (viaAlias && idx.byId.has(viaAlias)) return idx.byId.get(viaAlias);
  if (idx.byName.has(t)) return idx.byName.get(t);
  if (idx.byAlias.has(t)) return idx.byAlias.get(t);
  return null;
}

/**
 * 使用者打字找食材：精確命中排最前，然後才是名稱包含、俗名包含。
 * 回傳 [{ food, how }]，how ∈ alias | name | aliasExact | nameHas | aliasHas。
 */
export function searchFoods(query, idx, limit = 20) {
  const q = String(query ?? '').trim();
  if (!q) return [];
  const out = [];
  const seen = new Set();
  const push = (food, how) => {
    if (!food || seen.has(food.id)) return;
    seen.add(food.id);
    out.push({ food, how });
  };
  const viaAlias = idx.aliasMap.get(q);
  if (viaAlias) push(idx.byId.get(viaAlias), 'alias');
  push(idx.byName.get(q), 'name');
  push(idx.byAlias.get(q), 'aliasExact');
  for (const f of idx.list) {
    if (out.length >= limit) break;
    if (f.name.includes(q)) push(f, 'nameHas');
  }
  for (const f of idx.list) {
    if (out.length >= limit) break;
    if (f.aliases.some((a) => a.includes(q))) push(f, 'aliasHas');
  }
  return out.slice(0, limit);
}

/** 哪些鍵（依 build-foods 的順序）；畫面上顯示的順序也照這個。 */
export const NUTRIENT_ORDER = ['kcal', 'protein', 'fat', 'satFat', 'carb', 'sugar', 'fiber', 'sodium', 'potassium', 'phosphorus', 'calcium', 'cholesterol'];

export const NUTRIENT_LABELS = {
  kcal: '熱量', protein: '蛋白質', fat: '脂肪', satFat: '飽和脂肪', carb: '碳水化合物（醣）', sugar: '糖',
  fiber: '膳食纖維', sodium: '鈉', potassium: '鉀', phosphorus: '磷', calcium: '鈣', cholesterol: '膽固醇',
};

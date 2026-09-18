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
  // foods.json 裡每筆的 n 是**陣列**（12 個鍵名重複 2,151 次會佔掉整個檔案三分之一），
  // 順序由檔案自己的 nutrients 欄位宣告 —— 讀檔時照那個順序還原成物件，
  // 建檔端與讀檔端就不會各自寫死一份順序而悄悄對不上（那會讓每個營養值都錯位）。
  const order = foodsJson.nutrients;
  if (!Array.isArray(order) || order.length === 0) throw new Error('foods.json 缺 nutrients（營養值的欄位順序）');
  const list = foodsJson.foods.map((f) => (Array.isArray(f.n)
    ? { ...f, n: Object.fromEntries(order.map((k, i) => [k, f.n[i] ?? null])) }
    : f));
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
 * 「平均值家族」（2026-09-18 Yolin 定案，九項調整第 6 項 (a)）：食藥署把同一樣食材分得很細 ——
 * 杏鮑菇有「平均值、(大)、(中)、(小)」，稉米有九個品種，山藥有十幾個產地。**有「X平均值」那一筆的家族**，
 * 找食材時只列平均值那一筆、顯示成簡單的「X」，同家族的「X(…)」細分不列出來。
 * **資料一筆都不刪、編號不改**：舊食譜用到細分的照樣認得、照樣顯示原名。
 * 同一個 X 有好幾筆平均值的（西瓜紅肉／黃肉、李子三種），簡名保留括號裡的區別，免得出現兩個一樣的「西瓜」。
 * 回 { hidden: Set<id>, display: Map<id, 簡名>, parent: Map<細分 id, 平均值 id> }；算一次就掛在 idx 上。
 */
export function foodFamilies(idx) {
  if (idx._families) return idx._families;
  const hidden = new Set();
  const display = new Map();
  const parent = new Map();
  const avgs = idx.list.filter((f) => f.name.includes('平均值'));
  const baseOf = (f) => f.name.slice(0, f.name.indexOf('平均值'));
  const byBase = new Map();
  for (const p of avgs) { const b = baseOf(p); if (!byBase.has(b)) byBase.set(b, []); byBase.get(b).push(p); }
  for (const [base, ps] of byBase) {
    for (const p of ps) {
      const rest = p.name.slice(base.length + '平均值'.length).replace(/^[(（]|[)）]$/g, '');
      display.set(p.id, ps.length > 1 && rest ? `${base}（${rest}）` : base);
    }
    for (const f of idx.list) {
      if (f.name.includes('平均值') || !f.name.startsWith(base)) continue;
      // 「X(…)」是細分；名稱剛好就是「X」的那一筆（乾香菇平均值旁邊的「乾香菇」）也算同家族
      const tail = f.name.slice(base.length);
      if (tail && !/^[(（]/.test(tail)) continue;
      const same = ps.filter((p) => p.cat === f.cat);
      if (!same.length) continue;
      hidden.add(f.id);
      if (same.length === 1) parent.set(f.id, same[0].id);
    }
  }
  idx._families = { hidden, display, parent };
  return idx._families;
}

/** 畫面上叫這樣食材什麼：平均值那一筆用簡名，其他用食藥署原名。 */
export function displayNameOf(food, idx) {
  if (!food) return '';
  return foodFamilies(idx).display.get(food.id) ?? food.name;
}

/**
 * 使用者打字找食材：精確命中排最前，然後才是名稱包含、俗名包含。
 * 回傳 [{ food, how, display, alias? }]，how ∈ alias | name | aliasExact | nameHas | aliasHas。
 * collapse：只列平均值家族的代表（新增食譜的畫面用）；精確命中細分時換成它的平均值那一筆。
 */
export function searchFoods(query, idx, limit = 20, { collapse = false } = {}) {
  const q = String(query ?? '').trim();
  if (!q) return [];
  const fam = collapse ? foodFamilies(idx) : null;
  const out = [];
  const seen = new Set();
  const push = (food, how, alias = null) => {
    if (!food) return;
    if (fam && fam.hidden.has(food.id)) {
      if (!['alias', 'name', 'aliasExact'].includes(how) || !fam.parent.has(food.id)) return;
      food = idx.byId.get(fam.parent.get(food.id));
    }
    if (seen.has(food.id)) return;
    seen.add(food.id);
    out.push({ food, how, display: fam ? displayNameOf(food, idx) : food.name, ...(alias ? { alias } : {}) });
  };
  const viaAlias = idx.aliasMap.get(q);
  if (viaAlias) push(idx.byId.get(viaAlias), 'alias', q);
  push(idx.byName.get(q), 'name');
  push(idx.byAlias.get(q), 'aliasExact', q);
  // 簡名剛好等於打的字（「杏鮑菇」→ 杏鮑菇平均值）也算精確命中
  if (fam) for (const [id, name] of fam.display) if (name === q) push(idx.byId.get(id), 'name');
  for (const f of idx.list) {
    if (out.length >= limit) break;
    if (f.name.includes(q)) push(f, 'nameHas');
  }
  for (const f of idx.list) {
    if (out.length >= limit) break;
    const a = f.aliases.find((x) => x.includes(q));
    if (a) push(f, 'aliasHas', a);
  }
  return out.slice(0, limit);
}

/** 編號 → 別名表裡指到它的所有口語詞（依 aliases.json 的順序）。採買單位、保存天數用口語詞查。 */
export function aliasTermsOf(idx) {
  const out = new Map();
  for (const [term, id] of idx.aliasMap) { if (!out.has(id)) out.set(id, []); out.get(id).push(term); }
  return out;
}

/** 哪些鍵（依 build-foods 的順序）；畫面上顯示的順序也照這個。 */
export const NUTRIENT_ORDER = ['kcal', 'protein', 'fat', 'satFat', 'carb', 'sugar', 'fiber', 'sodium', 'potassium', 'phosphorus', 'calcium', 'cholesterol'];

export const NUTRIENT_LABELS = {
  kcal: '熱量', protein: '蛋白質', fat: '脂肪', satFat: '飽和脂肪', carb: '碳水化合物（醣）', sugar: '糖',
  fiber: '膳食纖維', sodium: '鈉', potassium: '鉀', phosphorus: '磷', calcium: '鈣', cholesterol: '膽固醇',
};

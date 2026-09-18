// 採買單位、調味料匙量、保存天數（data/units.json）的純函式。**不碰 DOM**，測試在 Node 直接 import。
//
// 全部是近似值：買菜買的是「一顆、半斤」，不是「437 克」。

/**
 * 需要幾個採買單位才夠 grams。**寧可多買半個，不可少買**：
 * 無條件進位到 0.5 單位（437 克的高麗菜、一顆 1000 克 → 0.5 顆）。
 */
export function toBuyQty(grams, unitDef) {
  if (!unitDef || !(unitDef.grams > 0) || !(grams > 0)) return null;
  const raw = grams / unitDef.grams;
  const qty = Math.ceil(raw * 2) / 2;
  return { qty, unit: unitDef.unit, grams: qty * unitDef.grams };
}

// ---- 新增食譜時用直覺單位填（2026-09-18 Yolin 定案，九項調整第 6 項 (c)）----
// 存的永遠是克（營養、購物清單都用克算）；單位只是填的時候方便，另外記在 ingredient.entry 讓下次編輯看得到原本怎麼填的。
export const JIN_GRAMS = 600;
/** 食藥署的「單位重」沒寫單位名稱（米的單位重其實是一杯），只在一顆一個的類別當「個／顆」用。 */
export const COUNT_UNIT_BY_CAT = { 蛋類: '顆', 蔬菜類: '個', 水果類: '個', 菇類: '個' };

/**
 * 這樣食材可以用哪些單位填。回 [{ unit, grams }]（1 單位幾克），**第一個是預設**，「克」一定在最後（可以切回克）。
 * 順序：採買單位（顆／把／條／根／盒…）→ 沒有採買單位的蛋、蔬果、菇用單位重當「顆／個」→ 調味料的大匙、小匙 → 肉魚加「斤」→ 克。
 * @param terms 這樣食材的口語詞（foods.aliasTermsOf），units.json 是用口語詞查的
 */
export function entryUnitsFor(food, { terms = [], units } = {}) {
  const out = [];
  const add = (unit, grams) => { if (grams > 0 && !out.some((o) => o.unit === unit)) out.push({ unit, grams: Math.round(grams * 10) / 10 }); };
  if (food) {
    const keys = [...terms, food.name];
    let buy = null;
    for (const t of keys) { const u = units?.buyUnits?.[t]; if (u && typeof u === 'object' && u.grams > 0) { buy = u; break; } }
    if (buy) add(buy.unit, buy.grams);
    else if (COUNT_UNIT_BY_CAT[food.cat] && food.unitWeight > 0) add(COUNT_UNIT_BY_CAT[food.cat], food.unitWeight);
    for (const t of keys) {
      const row = units?.spoonGrams?.[t];
      if (row && typeof row === 'object') { add('大匙', row['大匙']); add('小匙', row['小匙']); break; }
    }
    if (food.cat === '肉類' || food.cat === '魚貝類') add('斤', JIN_GRAMS);
  }
  add('克', 1);
  return out;
}

/** 填的數量 × 單位 → 克（四捨五入到 0.1 克）；數量不是正數回 null（＝沒填，營養寫「未估算」）。 */
export function entryToGrams(qty, unitDef) {
  const q = Number(qty);
  if (!(q > 0) || !unitDef || !(unitDef.grams > 0)) return null;
  return Math.round(q * unitDef.grams * 10) / 10;
}

/** 克 → 這個單位要填多少（切換單位時用；克數不變）。克以外取到 0.01。 */
export function gramsToEntry(grams, unitDef) {
  if (!(grams > 0) || !unitDef || !(unitDef.grams > 0)) return null;
  const q = grams / unitDef.grams;
  return unitDef.grams === 1 ? Math.round(q * 10) / 10 : Math.round(q * 100) / 100;
}

/** 「1 大匙醬油」→ 克；查不到回 null（不猜）。 */
export function spoonToGrams(term, spoon, units) {
  const row = units?.spoonGrams?.[term];
  const g = row && typeof row === 'object' ? row[spoon] : null;
  return typeof g === 'number' && g > 0 ? g : null;
}

/**
 * 從買菜日起算幾天內要煮掉。口語詞的 override 優先，再用食藥署分類的預設；
 * 兩個都沒有回 null（週計畫會把 null 當「不限制」並在說明裡講出來）。
 *
 * `aliases` 收一個食材的**所有**口語詞，不是隨便挑一個。同一個編號常常有好幾個叫法
 * （E1900103 是「老薑」也是「薑」、E3101001 是「紅蘿蔔」也是「胡蘿蔔」），
 * 只看其中一個的話，override 表上明明寫了 30 天的薑會落回蔬菜類的 3 天 ——
 * 使用者在「為什麼選這道」會看到「薑大約只放 3 天」這種錯數字。
 * 好幾個都命中時取**最短**的：排菜寧可早點煮掉。
 */
export function shelfDaysFor({ alias = null, aliases = null, cat = null }, units) {
  const o = units?.shelfDays?.overrides ?? {};
  const terms = aliases ?? (alias == null ? [] : [alias]);
  let best = null;
  for (const t of terms) if (typeof o[t] === 'number' && (best == null || o[t] < best)) best = o[t];
  if (best != null) return best;
  const c = units?.shelfDays?.byCategory ?? {};
  if (cat && typeof c[cat] === 'number') return c[cat];
  return null;
}

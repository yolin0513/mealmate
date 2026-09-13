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

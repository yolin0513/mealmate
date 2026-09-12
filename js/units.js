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
 */
export function shelfDaysFor({ alias, cat }, units) {
  const o = units?.shelfDays?.overrides ?? {};
  if (alias && typeof o[alias] === 'number') return o[alias];
  const c = units?.shelfDays?.byCategory ?? {};
  if (cat && typeof c[cat] === 'number') return c[cat];
  return null;
}

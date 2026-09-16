// 購物清單（PLAN §4.3「買菜日與購物清單」）。**純函式、不碰 DOM、不碰 IndexedDB**。
//
// 數量是使用者會實際照著買的東西，所以規則寫死、測試逐條守：
//   · 採買區間 ＝ 從某個買菜日到下一個買菜日前一天；一週的每一個自己煮的日子剛好屬於一個區間（無縫、無重疊）
//   · 食材克數依實際吃的人數縮放：共用軌 × 吃得了的人數 ÷ 食譜份數；素鍋軌 × 吃素版人數 ÷ 素版份數；
//     葷鍋軌 × 吃葷版人數 ÷ 葷版份數。沒有家人就照食譜原份量。沒人吃的軌（例如全家吃葷 → 素鍋）不買
//   · 同一個食材跨餐加總（用食藥署編號對，不用名稱）
//   · 常備品（油鹽醬油米）不進主清單，另列一段
//   · 外食、不煮的格子不進清單
//   · 換算成「約幾顆、幾把」用 units.js 的 toBuyQty（無條件進位到半個單位、不少買）；沒有採買單位的顯示克數

import { versionFor } from './members.js';
import { lastShoppingDayOnOrBefore, parseDate, DAY_LABELS } from './planner.js';
import { toBuyQty } from './units.js';
import { aliasTermsOf } from './foods.js';

export const SECTIONS = ['蔬菜', '水果', '肉', '魚貝', '豆製品蛋奶', '乾貨雜糧', '調味與其他'];
const CAT_SECTION = {
  '蔬菜類': '蔬菜', '菇類': '蔬菜', '藻類': '蔬菜',
  '水果類': '水果',
  '肉類': '肉',
  '魚貝類': '魚貝',
  '蛋類': '豆製品蛋奶', '乳品類': '豆製品蛋奶', '豆類': '豆製品蛋奶',
  '穀物類': '乾貨雜糧', '澱粉類': '乾貨雜糧', '堅果及種子類': '乾貨雜糧',
  '調味料及香辛料類': '調味與其他', '油脂類': '調味與其他', '糖類': '調味與其他', '飲料類': '調味與其他', '糕餅點心類': '乾貨雜糧',
};
/** 賣場分區：豆腐豆干這類加工品歸豆製品，其他加工品歸乾貨。 */
export function sectionOf(food) {
  if (food.cat === '加工調理食品及其他類') return /豆腐|豆干|豆皮|豆包|百頁|豆豉|豆漿/.test(food.name) ? '豆製品蛋奶' : '乾貨雜糧';
  return CAT_SECTION[food.cat] ?? '調味與其他';
}

/** 這道菜每一軌要乘的倍數（依實際吃的人）。沒有家人 → 全部 1。 */
export function scaleFor(recipe, members) {
  if (!members || members.length === 0) return { base: 1, veg: 1, meat: 1 };
  let veg = 0; let meat = 0; let all = 0;
  for (const m of members) {
    const v = versionFor(recipe, m.diet);
    if (v === 'veg') veg += 1;
    else if (v === 'meat') meat += 1;
    else if (v === 'all') all += 1;
  }
  if (recipe.vegMode !== 'splittable') return { base: all / recipe.servings, veg: 0, meat: 0 };
  const eaters = veg + meat;
  return { base: eaters / recipe.servings, veg: veg / recipe.splitServings.veg, meat: meat / recipe.splitServings.meat };
}

function fmtMD(iso) { const d = parseDate(iso); return `${d.getMonth() + 1}/${d.getDate()}`; }
function dayLabel(iso) { return DAY_LABELS[(parseDate(iso).getDay() + 6) % 7]; }

/**
 * 把一週的自己煮日子切成採買區間。沒設買菜日 → 一個「整週」區間。
 * 回 [{ key, label, dates }]，key 是買菜日（可能在上一週），dates 依序。
 */
export function rangesOfPlan(plan, shoppingDays) {
  const cookDates = [...new Set(plan.slots.filter((s) => s.kind === 'cook' && s.items.length).map((s) => s.date))].sort();
  if (!Array.isArray(shoppingDays) || shoppingDays.length === 0) {
    return cookDates.length ? [{ key: plan.monday, label: '整週（尚未設定買菜日）', dates: cookDates }] : [];
  }
  const map = new Map();
  for (const d of cookDates) {
    const key = lastShoppingDayOnOrBefore(d, shoppingDays) ?? plan.monday;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(d);
  }
  return [...map.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([key, dates]) => ({
    key,
    label: `${fmtMD(key)}（${dayLabel(key)}）買${key < plan.monday ? '（上週）' : ''}`,
    dates,
  }));
}

/**
 * 產生購物清單。
 * @returns {{ ranges: [{ key, label, dates, items: [...], pantry: [...] }] }}
 *   item：{ foodId, name, labels: string[], grams, buy: {qty, unit, grams}|null, section, uses: [{date, meal, recipe}] }
 */
export function buildShoppingList({ plan, recipesById, members = [], idx, units, shoppingDays = [], manualByRange = {}, customByRange = {} }) {
  const terms = aliasTermsOf(idx);
  const buyUnitFor = (foodId) => {
    for (const t of terms.get(foodId) ?? []) { const u = units?.buyUnits?.[t]; if (u && typeof u === 'object' && u.grams > 0) return u; }
    return null;
  };
  const ranges = rangesOfPlan(plan, shoppingDays).map((r) => ({
    ...r, items: [], pantry: [],
    // 自己加的項目跟著這張採買卡走（per-range），整理成乾淨的形狀；不參與任何克數計算
    custom: sanitizeCustom(customByRange[r.key]),
  }));
  for (const range of ranges) {
    const agg = new Map();     // foodId → item
    const pantry = new Map();  // foodId → { foodId, name, labels }
    for (const slot of plan.slots) {
      if (slot.kind !== 'cook' || !range.dates.includes(slot.date)) continue;
      for (const it of slot.items) {
        const r = recipesById.get(it.recipeId);
        if (!r) continue;
        const scale = scaleFor(r, members);
        for (const ing of r.ingredients) {
          const food = idx.byId.get(ing.food);
          // 使用者自己加的菜裡、食藥署查不到的食材（例如豬耳朵）：沒有分類也沒有採買單位，但還是要買 ——
          // 用名稱當鍵，照克數加總，放「調味與其他」。沒填克數的跟其他食材一樣不列（不知道要買多少）。
          const key = food ? food.id : (ing.unresolved ? `unresolved:${String(ing.label ?? '').replace(/（.*?）/g, '').trim()}` : null);
          if (!key) continue;
          const name = food ? food.name : key.slice('unresolved:'.length);
          const k = scale[ing.track ?? 'base'] ?? 0;
          if (ing.pantry) {
            if (!pantry.has(key)) pantry.set(key, { foodId: key, name, labels: [] });
            if (!pantry.get(key).labels.includes(ing.label)) pantry.get(key).labels.push(ing.label);
            continue;
          }
          if (ing.grams == null || k <= 0) continue;
          const grams = ing.grams * k;
          if (!agg.has(key)) agg.set(key, { foodId: key, name, labels: [], grams: 0, buy: null, section: food ? sectionOf(food) : '調味與其他', uses: [], ...(food ? {} : { unresolved: true }) });
          const item = agg.get(key);
          item.grams += grams;
          const shortLabel = ing.label.replace(/（.*?）/g, '').trim();
          if (!item.labels.includes(shortLabel)) item.labels.push(shortLabel);
          item.uses.push({ date: slot.date, meal: slot.meal, recipe: r.name });
        }
      }
    }
    const manual = manualByRange[range.key] ?? {};
    for (const item of agg.values()) {
      item.grams = Math.round(item.grams);
      const u = buyUnitFor(item.foodId);
      item.buy = u ? toBuyQty(item.grams, u) : null;
      // 使用者自己改的數量。**建議值留著**（suggested），才回得去，畫面上也才講得出「原本建議 2 條」。
      // 手改的單位跟建議值同一個：有 buyUnit 的就改「幾條」，沒有的就改克數。
      item.suggested = { grams: item.grams, buy: item.buy ? { ...item.buy } : null };
      const m = manual[item.foodId];
      if (m != null) {
        const q = Number(m);
        if (Number.isFinite(q) && q > 0) {
          item.manual = true;
          if (u && item.buy) item.buy = { qty: q, unit: u.unit, grams: Math.round(q * u.grams) };
          else item.grams = Math.round(q);
        }
      }
    }
    range.items = [...agg.values()].sort((a, b) => SECTIONS.indexOf(a.section) - SECTIONS.indexOf(b.section) || b.grams - a.grams);
    range.pantry = [...pantry.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
  }
  return { ranges };
}

/** 自己加的項目在 checked 裡的鍵。跟食材編號分開命名空間，免得撞到。 */
export const CUSTOM_PREFIX = 'custom:';
export function customKey(id) { return `${CUSTOM_PREFIX}${id}`; }

/**
 * 使用者自己加的採買項目（例如飯後水果）。**不是食材**：不解析到食藥署編號、
 * 不進營養計算，也不影響排菜 —— 純粹是「這趟也要買」的備忘。
 * 名稱必填、數量可不填（「一串」「3 顆」這種自由文字）；亂填的收成乾淨的形狀。
 */
export function sanitizeCustom(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = new Set();
  for (const c of list) {
    const name = String(c?.name ?? '').trim().slice(0, 30);
    const id = String(c?.id ?? '').trim();
    if (!name || !id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name, qty: String(c?.qty ?? '').trim().slice(0, 12) });
  }
  return out;
}

/** 建議值（還沒被手改）的文字，用來告訴使用者「原本建議多少」。 */
export function suggestedText(item) {
  const s = item?.suggested;
  if (!s) return '';
  return s.buy ? `約 ${fmtQty(s.buy.qty)} ${s.buy.unit}（${s.grams} g）` : `約 ${s.grams} g`;
}

/** 手改時輸入框裡的數字與單位：有採買單位就改「幾條」，沒有的就改克數。 */
export function manualUnitOf(item) {
  return item?.buy ? { value: item.buy.qty, unit: item.buy.unit, step: 0.5 } : { value: item?.grams ?? 0, unit: 'g', step: 10 };
}

/** 一個項目要買多少的文字：「約 1 顆（713 g）」或「約 320 g」。 */
export function quantityText(item) {
  // 括號裡是「食譜需要幾克」，跟「要買幾顆」是兩件事（713 g 的高麗菜買 1 顆）。
  // 使用者自己改成 3 顆之後，需要幾克已經不是重點，再附上去只會讓人以為 3 顆＝375 克。
  if (item.manual && item.buy) return `約 ${fmtQty(item.buy.qty)} ${item.buy.unit}`;
  if (item.buy) return `約 ${fmtQty(item.buy.qty)} ${item.buy.unit}（${item.grams} g）`;
  return `約 ${item.grams} g`;
}
function fmtQty(q) { return Number.isInteger(q) ? String(q) : q.toFixed(1); }

/** 純文字版（複製到 LINE 用）。 */
export function listAsText(range, { checked = {}, have = {} } = {}) {
  const lines = [`【${range.label}】給 ${range.dates.map(fmtMD).join('、')}`];
  for (const sec of SECTIONS) {
    const items = range.items.filter((it) => it.section === sec);
    if (!items.length) continue;
    lines.push(`— ${sec} —`);
    for (const it of items) {
      const mark = checked[it.foodId] ? '✓' : have[it.foodId] ? '（家裡有）' : '□';
      lines.push(`${mark} ${it.labels[0] ?? it.name}　${quantityText(it)}${it.manual ? '（已改）' : ''}`);
    }
  }
  // 自己加的另起一段，每一項都標出來 —— 貼到 LINE 的人才不會以為那是菜單算出來的
  if (range.custom?.length) {
    lines.push('— 自己加的（不算進菜單）—');
    for (const c of range.custom) {
      const mark = checked[customKey(c.id)] ? '✓' : '□';
      lines.push(`${mark} ${c.name}${c.qty ? `　${c.qty}` : ''}（自己加的）`);
    }
  }
  if (range.pantry.length) lines.push(`— 常備品（用完再補）—`, range.pantry.map((p) => p.labels[0] ?? p.name).join('、'));
  lines.push('（數量是估計值；依實際包裝與家人食量調整）');
  return lines.join('\n');
}

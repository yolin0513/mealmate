// 週計畫規劃器（PLAN §4.3）。**純函式、不碰 DOM、不碰 IndexedDB**，固定種子 → 固定結果。
//
// 紅線在程式碼裡的位置（每一條都有 plannertest 與突變盯著）：
//   · 慢性病留意項目**只降分、不排除**（scoreSoft 裡的 WATCH_PENALTY）；唯一會把菜排除出池子的
//     慢性病相關機制是使用者自己打開的「避開」開關（rules.avoid）
//   · 腎臟病只對 watchFields() 帶出來的欄位計分 —— 沒勾的欄位連分數都不參與
//   · 有素食成員時，每一格的菜都要是每位素食成員吃得了的版本（versionFor ≠ null）
//   · 早餐不吃「不重複」扣分（noRepeatDays.breakfast = 0）
//   · 池子不夠時**明講**（diagnostics.forcedRepeats／relaxed），不硬塞也不靜默重複
//   · reasons[] 只寫事實（「估 鈉 320 mg／份，低於池子中位數」），沒有建議語氣

import { estimate } from './nutrition.js';
import { versionFor, watchFields, DIET_LABELS } from './members.js';
import { shelfDaysFor } from './units.js';
import { NUTRIENT_LABELS } from './foods.js';
import { ROLE_LABELS, METHOD_LABELS } from './recipeschema.js';

export const MEALS = ['breakfast', 'lunch', 'dinner'];
export const MEAL_LABELS = { breakfast: '早餐', lunch: '午餐', dinner: '晚餐' };
export const DAY_LABELS = ['一', '二', '三', '四', '五', '六', '日'];
/** 午晚餐的角色順序：主菜最受限所以先選；主食看主菜是否已含主食。 */
export const MEAL_ROLES = { breakfast: ['breakfast'], lunch: ['main', 'side', 'staple'], dinner: ['main', 'side', 'soup', 'staple'] };

export const DEFAULT_RULES = {
  noRepeatDays: { main: 14, side: 7, soup: 7, breakfast: 0, staple: 0 },
  timeCaps: { weekday: { breakfast: 20, lunch: 35, dinner: 40 }, weekend: { breakfast: 40, lunch: 60, dinner: 60 } },
  fishPerWeek: 2,
  avoid: { sweet: false, processed: false, fried: false },
};

const NO_REPEAT_PENALTY = { main: 100, side: 60, soup: 60, breakfast: 0, staple: 0 };
/** 同一餐不重複的烹法（PLAN §4.3：兩道炸、兩道湯）。兩道炒在台灣家常菜很平常，不算衝突。 */
export const EXCLUSIVE_METHODS = new Set(['deepfry', 'soup']);
const WATCH_PENALTY = 12;
const PROTEIN_LABELS = { pork: '豬', chicken: '雞', beef: '牛', lamb: '羊', duck: '鴨鵝', meat: '肉', fish: '魚', shellfish: '蝦蟹貝', egg: '蛋', soy: '豆製品' };

// ---------- 日期（一律本地日期字串，不用 toISOString，避免時區差一天） ----------
const pad2 = (n) => String(n).padStart(2, '0');
export function isoDate(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
export function parseDate(iso) { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); }
export function addDays(iso, n) { const d = parseDate(iso); d.setDate(d.getDate() + n); return isoDate(d); }
export function daysBetween(a, b) { return Math.round((parseDate(b) - parseDate(a)) / 86400000); }
/** 這一天所屬那週的星期一。 */
export function mondayOf(iso) { const d = parseDate(iso); const back = (d.getDay() + 6) % 7; d.setDate(d.getDate() - back); return isoDate(d); }
export function weekDates(mondayIso) { return Array.from({ length: 7 }, (_, i) => addDays(mondayIso, i)); }
/** ISO 週編號：2026-W38。 */
export function weekKeyOf(iso) {
  const d = parseDate(mondayOf(iso));
  const thursday = new Date(d); thursday.setDate(d.getDate() + 3);
  const jan1 = new Date(thursday.getFullYear(), 0, 1);
  const week = Math.floor((thursday - jan1) / 86400000 / 7) + 1;
  return `${thursday.getFullYear()}-W${pad2(week)}`;
}
export function isWeekend(iso) { const g = parseDate(iso).getDay(); return g === 0 || g === 6; }

// ---------- 決定性亂數 ----------
export function hashSeed(str) {
  let h = 2166136261;
  for (const ch of String(str)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
/** mulberry32：同一個 seed 永遠給同一串數字。 */
export function makeRng(seed) {
  let a = typeof seed === 'number' ? seed >>> 0 : hashSeed(seed);
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- 採買日 ----------
/** 這一天（含）之前最近的買菜日；沒設買菜日回 null。shoppingDays 用 JS getDay 的 0=週日。 */
export function lastShoppingDayOnOrBefore(iso, shoppingDays) {
  if (!Array.isArray(shoppingDays) || shoppingDays.length === 0) return null;
  for (let back = 0; back < 7; back += 1) {
    const d = addDays(iso, -back);
    if (shoppingDays.includes(parseDate(d).getDay())) return d;
  }
  return null;
}

// ---------- 中位數 ----------
export function medianOf(values) {
  const v = values.filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length < 2) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

// ---------- 建立規劃上下文 ----------
/**
 * @param recipes 全部食譜（內建＋使用者）
 * @param members 家人
 * @param idx     foods 索引（indexFoods）
 * @param units   data/units.json
 * @param rules   DEFAULT_RULES 的形狀（可部分覆寫）
 * @param favorites [{recipeId, wantThisWeek}]
 */
export function buildContext({ recipes, members = [], idx, units, rules = {}, favorites = [], shoppingDays = [], haveFoods = new Set() }) {
  const r = {
    noRepeatDays: { ...DEFAULT_RULES.noRepeatDays, ...(rules.noRepeatDays ?? {}) },
    timeCaps: { weekday: { ...DEFAULT_RULES.timeCaps.weekday, ...(rules.timeCaps?.weekday ?? {}) }, weekend: { ...DEFAULT_RULES.timeCaps.weekend, ...(rules.timeCaps?.weekend ?? {}) } },
    fishPerWeek: rules.fishPerWeek ?? DEFAULT_RULES.fishPerWeek,
    avoid: { ...DEFAULT_RULES.avoid, ...(rules.avoid ?? {}) },
  };
  const vegetarians = members.filter((m) => m.diet !== 'omni');
  const hasOmni = members.some((m) => m.diet === 'omni') || members.length === 0;
  // 誰留意哪個欄位（腎臟病只帶勾選的；沒勾就沒有）
  const watchers = new Map(); // field → [member]
  for (const m of members) for (const f of watchFields(m)) { if (!watchers.has(f)) watchers.set(f, []); watchers.get(f).push(m); }
  const hasDiabetes = members.some((m) => (m.conditions ?? []).includes('diabetes'));
  const needsSoft = members.some((m) => m.texture && m.texture !== 'normal');
  const favSet = new Set(favorites.map((f) => f.recipeId));
  const wantSet = new Set(favorites.filter((f) => f.wantThisWeek).map((f) => f.recipeId));
  const aliasById = new Map();
  for (const [term, id] of idx?.aliasMap ?? []) if (!aliasById.has(id)) aliasById.set(id, term);

  const estCache = new Map();
  const perServing = (recipe, version) => {
    const key = `${recipe.id}|${version}`;
    if (!estCache.has(key)) estCache.set(key, idx ? estimate(recipe, idx, { version }).perServing : null);
    return estCache.get(key);
  };
  /** 這道菜對「留意這個欄位的那些人」最高的每份值（他們各吃各的版本）。 */
  const watchedValue = (recipe, field) => {
    const ms = watchers.get(field) ?? [];
    let max = null;
    for (const m of ms) {
      const v = versionFor(recipe, m.diet);
      if (v === null) continue;
      const val = perServing(recipe, v)?.[field];
      if (val != null && (max == null || val > max)) max = val;
    }
    if (max == null && ms.length === 0) {
      const v = recipe.vegMode === 'splittable' ? (hasOmni ? 'meat' : 'veg') : 'all';
      max = perServing(recipe, v)?.[field] ?? null;
    }
    return max;
  };
  // 每個角色、每個留意欄位的池子中位數（拿來當「較高／較低」的參照，不是任何上限）
  const medians = {};
  for (const role of ['main', 'side', 'soup', 'staple', 'breakfast']) {
    medians[role] = {};
    for (const f of watchers.keys()) medians[role][f] = medianOf(recipes.filter((x) => x.role === role).map((x) => watchedValue(x, f)));
  }

  return { recipes, members, idx, units, rules: r, vegetarians, hasOmni, watchers, hasDiabetes, needsSoft, favSet, wantSet, aliasById, perServing, watchedValue, medians, shoppingDays, haveFoods: new Set(haveFoods) };
}

// ---------- 硬約束 ----------
/** 這道菜在這一格能不能選。回 null 表示可以，否則回不能的原因（給 diagnostics）。 */
export function hardBlock(recipe, { role, meal, date }, ctx, state, { relaxTime = false, relaxMethod = false, relaxDay = false } = {}) {
  if (recipe.role !== role) return 'role';
  // 同一天不排同一道菜（午餐晚餐都是番茄炒蛋這種）；真的沒得選才放寬
  if (!relaxDay && state.dayRecipes && state.dayRecipes(date).has(recipe.id)) return 'sameDay';
  const { rules } = ctx;
  if (rules.avoid.sweet && recipe.tags.includes('sweet')) return 'avoid:sweet';
  if (rules.avoid.processed && recipe.tags.includes('processed')) return 'avoid:processed';
  if (rules.avoid.fried && recipe.method === 'deepfry') return 'avoid:fried';
  // 有素食成員：每一位都要吃得了（吃素版也算）
  for (const m of ctx.vegetarians) if (versionFor(recipe, m.diet) === null) return `diet:${m.name}`;
  // 保存期限：距上次買菜日太久的葉菜、海鮮不排
  const lastShop = lastShoppingDayOnOrBefore(date, ctx.shoppingDays);
  if (lastShop && ctx.idx) {
    const since = daysBetween(lastShop, date);
    for (const ing of recipe.ingredients) {
      if (ing.pantry) continue;
      const food = ctx.idx.byId.get(ing.food);
      if (!food) continue;
      const days = shelfDaysFor({ alias: ctx.aliasById.get(food.id) ?? null, cat: food.cat }, ctx.units);
      if (days != null && since > days) return `shelf:${ing.label}`;
    }
  }
  // 時間上限不算主食：電鍋煮飯是放著不管的時間，不是動手時間
  if (!relaxTime && role !== 'staple') {
    const caps = isWeekend(date) ? rules.timeCaps.weekend : rules.timeCaps.weekday;
    if (recipe.time > caps[meal]) return 'time';
  }
  const mealItems = state.slotItems ?? [];
  if (mealItems.some((it) => it.recipeId === recipe.id)) return 'dup';
  if (!relaxMethod && EXCLUSIVE_METHODS.has(recipe.method) && mealItems.some((it) => it.method === recipe.method)) return 'method';
  return null;
}

// ---------- 軟分數 ＋ 理由 ----------
export function scoreSoft(recipe, { role, meal, date, day }, ctx, state, rng) {
  let score = 0;
  const reasons = [];
  const { rules } = ctx;

  // 不重複（早餐與主食是 0 天 → 不扣）
  const noRepeat = rules.noRepeatDays[role] ?? 0;
  const last = state.lastServed(recipe.id, date);
  if (noRepeat > 0) {
    if (last != null && last <= noRepeat) { score -= NO_REPEAT_PENALTY[role] ?? 60; reasons.push(`上次是 ${last} 天前（${noRepeat} 天內重複，因為符合條件的菜不夠）`); }
    else reasons.push(last == null ? `${noRepeat} 天內沒出現過` : `上次是 ${last} 天前`);
  } else if (role === 'breakfast') {
    // 早餐只做輪替、不算重複：出現過幾次就小扣幾分，讓幾道早餐輪著來
    const times = state.timesServedWithin(recipe.id, date, 7);
    score -= 2 * times;
    reasons.push(times ? `早餐輪替，這 7 天第 ${times + 1} 次` : '早餐輪替，這 7 天第 1 次');
  }

  // 蛋白質輪替（主菜）
  if (role === 'main' && recipe.proteins.length) {
    const labels = recipe.proteins.map((p) => PROTEIN_LABELS[p] ?? p);
    const sameDay = recipe.proteins.filter((p) => state.dayProteins(day).has(p));
    if (sameDay.length) score -= 25;
    const prev = recipe.proteins.filter((p) => state.prevDayMealProteins(day, meal).has(p));
    if (prev.length) score -= 8;
    const isFish = recipe.proteins.some((p) => p === 'fish' || p === 'shellfish');
    if (isFish && state.fishCount() < rules.fishPerWeek) { score += 15; reasons.push(`蛋白質來源：${labels.join('、')}；這週第 ${state.fishCount() + 1} 次吃魚貝`); }
    else reasons.push(`蛋白質來源：${labels.join('、')}${sameDay.length ? '（今天另一餐也是）' : ''}`);
  }

  // 素食成員：吃哪個版本（事實）
  for (const m of ctx.vegetarians) {
    const v = versionFor(recipe, m.diet);
    if (v) reasons.push(`${m.name}（${DIET_LABELS[m.diet]}）可吃${v === 'veg' ? '素版' : ''}`);
  }

  // 留意欄位：只降分、不排除。參照是這個角色池子的中位數，不是任何上限。
  for (const [field] of ctx.watchers) {
    const val = ctx.watchedValue(recipe, field);
    const med = ctx.medians[role]?.[field];
    if (val == null || med == null) continue;
    const unit = ctx.idx?.units?.[field] ?? '';
    const fmt = (x) => (unit === 'g' ? (Math.round(x * 10) / 10) : Math.round(x));
    if (val > med) { score -= WATCH_PENALTY; reasons.push(`估 ${NUTRIENT_LABELS[field]} ${fmt(val)} ${unit}／份，高於${ROLE_LABELS[role]}池子的中位數 ${fmt(med)}`); }
    else reasons.push(`估 ${NUTRIENT_LABELS[field]} ${fmt(val)} ${unit}／份，不高於${ROLE_LABELS[role]}池子的中位數 ${fmt(med)}`);
  }
  if (ctx.hasDiabetes) {
    if (role === 'staple' && recipe.tags.includes('wholegrain')) { score += 12; reasons.push('全穀雜糧主食（家中有留意醣的成員）'); }
    if (recipe.tags.includes('sweet')) { score -= 15; reasons.push('含精緻糖（家中有留意醣的成員）'); }
  }
  if (role === 'staple' && !(ctx.hasDiabetes && recipe.tags.includes('wholegrain'))) {
    reasons.push(recipe.tags.includes('wholegrain') ? '全穀雜糧主食' : '一般主食（白米或麵）');
  }

  // 收藏、本週想吃
  if (ctx.wantSet.has(recipe.id) && !state.placedWant.has(recipe.id)) { score += 40; reasons.push('你勾了「本週想吃」'); }
  else if (ctx.favSet.has(recipe.id)) { score += 12; reasons.push('你的收藏'); }

  // 當季
  const month = parseDate(date).getMonth() + 1;
  if (recipe.season.length === 0 || recipe.season.includes(month)) { if (recipe.season.length) { score += 6; reasons.push(`當季（${month} 月）`); } }
  else score -= 6;

  // 質地
  if (ctx.needsSoft && (role === 'main' || role === 'side') && recipe.texture !== 'normal') { score += 8; reasons.push('軟質，家裡有需要好咬的成員'); }

  // 採買效率：同一個採買區間已經會買的食材
  const lastShop = lastShoppingDayOnOrBefore(date, ctx.shoppingDays);
  if (lastShop) {
    const already = recipe.ingredients.filter((ing) => !ing.pantry && state.rangeHas(lastShop, ing.food));
    if (already.length) { score += Math.min(12, already.length * 3); reasons.push(`${already.slice(0, 2).map((i) => i.label.replace(/（.*?）/g, '')).join('、')}這幾天已經會買`); }
  }
  // 購物清單勾了「家裡有」的食材
  if (ctx.haveFoods.size) {
    const have = recipe.ingredients.filter((ing) => !ing.pantry && ctx.haveFoods.has(ing.food));
    if (have.length) { score += Math.min(9, have.length * 3); reasons.push(`${have.slice(0, 2).map((i) => i.label.replace(/（.*?）/g, '')).join('、')}你勾了家裡有`); }
  }

  reasons.push(`約 ${recipe.time} 分鐘，${METHOD_LABELS[recipe.method]}`);
  score += rng() * 3;
  return { score, reasons };
}

// ---------- 狀態（這一週已經排了什麼） ----------
function makeState(history, ctx, monday) {
  const served = new Map(); // recipeId → [dates]
  const add = (id, date) => { if (!served.has(id)) served.set(id, []); served.get(id).push(date); };
  for (const h of history) add(h.recipeId, h.date);
  const proteinsByDay = new Map();    // `${day}` → Set
  const mainProteinsByDayMeal = new Map(); // `${day}|${meal}` → Set
  const rangeFoods = new Map();       // lastShopDate → Set(foodId)
  let fish = 0;
  const placedWant = new Set();
  const byId = new Map(ctx.recipes.map((r) => [r.id, r]));
  const state = {
    slotItems: [],
    placedWant,
    // 同一天另一餐排過也算（diff 0）：正在評分的這道菜還沒 place()，所以不會算到自己
    lastServed(id, date) {
      const dates = served.get(id) ?? [];
      if (!dates.length) return null;
      let best = null;
      for (const d of dates) { const diff = Math.abs(daysBetween(d, date)); if (best == null || diff < best) best = diff; }
      return best;
    },
    timesServedWithin(id, date, days) { return (served.get(id) ?? []).filter((d) => Math.abs(daysBetween(d, date)) <= days).length; },
    dayRecipes(date) { return new Set([...served].filter(([, ds]) => ds.includes(date)).map(([id]) => id)); },
    dayProteins(day) { return proteinsByDay.get(String(day)) ?? new Set(); },
    prevDayMealProteins(day, meal) { return mainProteinsByDayMeal.get(`${day - 1}|${meal}`) ?? new Set(); },
    fishCount() { return fish; },
    rangeHas(lastShop, foodId) { return rangeFoods.get(lastShop)?.has(foodId) ?? false; },
    /** 把一道菜記進這一週的狀態。 */
    place(recipe, { day, meal, date }) {
      add(recipe.id, date);
      if (recipe.role === 'main') {
        if (!proteinsByDay.has(String(day))) proteinsByDay.set(String(day), new Set());
        for (const p of recipe.proteins) proteinsByDay.get(String(day)).add(p);
        const k = `${day}|${meal}`;
        if (!mainProteinsByDayMeal.has(k)) mainProteinsByDayMeal.set(k, new Set());
        for (const p of recipe.proteins) mainProteinsByDayMeal.get(k).add(p);
        if (recipe.proteins.some((p) => p === 'fish' || p === 'shellfish')) fish += 1;
      }
      const lastShop = lastShoppingDayOnOrBefore(date, ctx.shoppingDays);
      if (lastShop) {
        if (!rangeFoods.has(lastShop)) rangeFoods.set(lastShop, new Set());
        for (const ing of recipe.ingredients) if (!ing.pantry) rangeFoods.get(lastShop).add(ing.food);
      }
      if (ctx.wantSet.has(recipe.id)) placedWant.add(recipe.id);
    },
    byId,
  };
  void monday;
  return state;
}

/** 在一格裡為某個角色挑一道菜。回 { recipe, reasons, relaxed } 或 null（真的沒得選）。 */
export function pickForSlot(ctx, state, slotInfo, role, rng, { exclude = new Set() } = {}) {
  const attempts = [{}, { relaxMethod: true }, { relaxTime: true, relaxMethod: true }, { relaxTime: true, relaxMethod: true, relaxDay: true }];
  for (const relax of attempts) {
    let best = null;
    for (const recipe of ctx.recipes) {
      if (exclude.has(recipe.id)) continue;
      if (hardBlock(recipe, { ...slotInfo, role }, ctx, state, relax)) continue;
      const { score, reasons } = scoreSoft(recipe, { ...slotInfo, role }, ctx, state, rng);
      if (!best || score > best.score) best = { recipe, score, reasons };
    }
    if (best) {
      const relaxed = Object.keys(relax).filter((k) => relax[k]);
      if (relaxed.includes('relaxTime')) best.reasons.push('超過這一餐的時間上限，因為符合條件的菜不夠');
      return { ...best, relaxed };
    }
  }
  return null;
}

/**
 * 產生一週。prevPlan 裡 kind 不是 cook 的格子與 locked 的菜會原樣保留。
 * @returns {{ plan, diagnostics }}
 */
export function generateWeek({ recipes, members = [], idx, units, rules = {}, favorites = [], history = [], mondayIso, seed, prevPlan = null, shoppingDays = [] }) {
  const monday = mondayOf(mondayIso);
  const dates = weekDates(monday);
  const ctx = buildContext({ recipes, members, idx, units, rules, favorites, shoppingDays });
  const rng = makeRng(`${seed}|${monday}`);
  // 這一週自己的歷史不算（重新產生時舊格子會被換掉）；只帶這週之前 28 天內的
  const past = history.filter((h) => h.date < monday && daysBetween(h.date, monday) <= 28);
  const state = makeState(past, ctx, monday);
  const diagnostics = { forcedRepeats: [], relaxed: [], empty: [], poolSizes: {} };
  for (const role of ['main', 'side', 'soup', 'staple', 'breakfast']) diagnostics.poolSizes[role] = recipes.filter((r) => r.role === role).length;

  const prevSlots = new Map((prevPlan?.slots ?? []).map((s) => [`${s.day}|${s.meal}`, s]));
  const slots = [];
  // 先把鎖住的菜登記進狀態，別的格子才會避開它們
  for (let day = 0; day < 7; day += 1) for (const meal of MEALS) {
    const prev = prevSlots.get(`${day}|${meal}`);
    if (!prev) continue;
    for (const it of prev.items ?? []) if (it.locked || prev.kind !== 'cook') { const r = state.byId.get(it.recipeId); if (r && prev.kind === 'cook') state.place(r, { day, meal, date: dates[day] }); }
  }

  for (let day = 0; day < 7; day += 1) {
    for (const meal of MEALS) {
      const date = dates[day];
      const prev = prevSlots.get(`${day}|${meal}`);
      const slotInfo = { day, meal, date };
      if (prev && prev.kind !== 'cook') { slots.push({ ...prev, date }); continue; }
      const items = [];
      state.slotItems = items;
      const lockedItems = (prev?.items ?? []).filter((it) => it.locked && state.byId.has(it.recipeId));
      for (const it of lockedItems) items.push({ ...it, method: state.byId.get(it.recipeId).method });
      const hasStapleInMain = () => items.some((it) => it.role === 'main' && state.byId.get(it.recipeId)?.includesStaple);
      for (const role of MEAL_ROLES[meal]) {
        if (items.some((it) => it.role === role)) continue;           // 鎖住的已經有這個角色
        if (role === 'staple' && hasStapleInMain()) continue;          // 炒米粉這類主菜本身就是主食
        const picked = pickForSlot(ctx, state, slotInfo, role, rng);
        if (!picked) { diagnostics.empty.push({ date, meal, role }); continue; }
        const { recipe, reasons, relaxed } = picked;
        const last = state.lastServed(recipe.id, date);
        const noRepeat = ctx.rules.noRepeatDays[role] ?? 0;
        if (noRepeat > 0 && last != null && last <= noRepeat) diagnostics.forcedRepeats.push({ date, meal, role, recipeId: recipe.id, daysAgo: last });
        for (const c of relaxed) diagnostics.relaxed.push({ date, meal, role, constraint: c });
        items.push({ recipeId: recipe.id, role, locked: false, reasons, method: recipe.method });
        state.place(recipe, slotInfo);
      }
      slots.push({ day, date, meal, kind: 'cook', items: items.map(({ method, ...it }) => it) });
    }
  }
  state.slotItems = [];
  return { plan: { weekKey: weekKeyOf(monday), monday, seed: String(seed), slots }, diagnostics };
}

/** 把一格裡某個角色換一道（排除現在這道）。回新的 item 或 null。 */
export function swapItem({ plan, slotIndex, role, recipes, members, idx, units, rules, favorites, history, shoppingDays, seed }) {
  const slot = plan.slots[slotIndex];
  const ctx = buildContext({ recipes, members, idx, units, rules, favorites, shoppingDays });
  const past = history.filter((h) => daysBetween(h.date, plan.monday) <= 28 && h.date < plan.monday);
  const state = makeState(past, ctx, plan.monday);
  // 這一週其他格子的菜都算「已排」
  for (const s of plan.slots) {
    if (s.kind !== 'cook') continue;
    for (const it of s.items) {
      if (s === slot && it.role === role) continue;
      const r = state.byId.get(it.recipeId);
      if (r) state.place(r, { day: s.day, meal: s.meal, date: s.date });
    }
  }
  state.slotItems = slot.items.filter((it) => it.role !== role).map((it) => ({ ...it, method: state.byId.get(it.recipeId)?.method }));
  const current = slot.items.find((it) => it.role === role);
  const rng = makeRng(`${seed}|swap|${slotIndex}|${role}|${Date.now()}`);
  const picked = pickForSlot(ctx, state, { day: slot.day, meal: slot.meal, date: slot.date }, role, rng, { exclude: new Set(current ? [current.recipeId] : []) });
  if (!picked) return null;
  return { recipeId: picked.recipe.id, role, locked: false, reasons: picked.reasons };
}

/** 直接指定一道菜到某格的某個角色（使用者手選）。理由寫「你指定的」。 */
export function assignItem(plan, slotIndex, role, recipe) {
  const slot = plan.slots[slotIndex];
  const others = slot.items.filter((it) => it.role !== role);
  slot.items = [...others, { recipeId: recipe.id, role, locked: true, reasons: ['你指定的，已鎖定'] }];
  return slot;
}

/** 這一週要寫進 history 的列。 */
export function historyRowsOf(plan) {
  const rows = [];
  for (const s of plan.slots) {
    if (s.kind !== 'cook') continue;
    for (const it of s.items) rows.push({ date: s.date, recipeId: it.recipeId, meal: s.meal, role: it.role, weekKey: plan.weekKey });
  }
  return rows;
}

/**
 * 一天的每人估計（每位家人吃自己的版本；沒有家人時給「不分流／葷版」一份）。
 * 回 [{ label, diet, fields: {key: number|null}, missing: number }]
 */
export function dailyEstimates(daySlots, members, idx, recipesById, fields) {
  const rows = [];
  const who = members.length ? members.map((m) => ({ label: m.name, diet: m.diet })) : [{ label: '每人一份', diet: 'omni' }];
  for (const w of who) {
    const sums = Object.fromEntries(fields.map((f) => [f, null]));
    let missing = 0;
    for (const s of daySlots) {
      if (s.kind !== 'cook') continue;
      for (const it of s.items) {
        const r = recipesById.get(it.recipeId);
        if (!r) continue;
        const v = versionFor(r, w.diet);
        if (v === null) { missing += 1; continue; }
        const per = estimate(r, idx, { version: v }).perServing;
        for (const f of fields) if (per[f] != null) sums[f] = (sums[f] ?? 0) + per[f];
      }
    }
    rows.push({ ...w, fields: sums, missing });
  }
  return rows;
}

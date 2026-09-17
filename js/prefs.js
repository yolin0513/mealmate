// 設定值（存在 IndexedDB 的 settings store，一個 key 一筆）。
//
// 預設值集中在 DEFAULTS。測試盯著其中幾條：
//   noRepeatDays.breakfast 是 0 —— 早餐不納入不重複（PLAN §2）
//   dailyTargets 預設是空物件 —— App 不替任何人設定每日目標（PLAN §1.2 第 4 點）
//   disclaimerAcceptedAt 預設 null —— 沒按過「我知道了」

import * as db from './db.js';

export const DEFAULTS = {
  fontScale: 'md',                 // md | lg（長輩模式）
  shoppingDays: [],                // 0=週日 … 6=週六
  noRepeatDays: { main: 14, side: 7, soup: 7, breakfast: 0, staple: 0 },
  disclaimerAcceptedAt: null,
  dailyTargets: {},
  // 「避開」開關：使用者自己打開才會把菜排除出池子；預設全關（慢性病留意項目本身只降分、不排除）
  avoid: { sweet: false, processed: false, fried: false },
  // 一週排幾道比較豐盛的主菜：low 2／medium 4／high 6（planner.HEARTY_LEVELS）。只影響分數，不排除。
  heartyLevel: 'medium',
  // 這週用的亂數種子；「重新產生」會換一個
  planSeed: null,
  // 本週頁每一天是收起來還是展開。**依週存**：{ '2026-W38': { 0: 'closed', 3: 'open' } }。
  // 沒記到的那幾天照預設：**今天之前的收起來（已過）、其餘展開**（2026-09-18 使用者要求「過了的日子不要再攤開」）。
  // 所以手動展開也要記（值是 'open'），不然過去的日子點開之後一重畫又收回去。
  // 舊資料是陣列 [5, 6]（只記收起來的），讀的時候當成 { 5: 'closed', 6: 'closed' }。
  // 存成全域的「星期六日一律收起來」也行，但實際用法多半是這一週的事；只留最近幾週，免得無限長大。
  collapsedDays: {},
};

/**
 * 這一週每一天**手動**設成什麼：{ 0: 'closed', 3: 'open' }（0 = 週一）。沒設的天不在裡面（由畫面決定預設）。
 * 舊格式是陣列 [5, 6]（只記收起來的）→ 當成 { 5: 'closed', 6: 'closed' }。
 */
export function dayFoldsFor(weekKey) {
  const all = get('collapsedDays') ?? {};
  const v = all[weekKey];
  if (Array.isArray(v)) return Object.fromEntries(v.map((d) => [d, 'closed']));
  if (v && typeof v === 'object') return { ...v };
  return {};
}

/** 這一週有哪幾天是手動收起來的（0 = 週一）。留著給舊的呼叫端與測試用。 */
export function collapsedDaysFor(weekKey) {
  return Object.entries(dayFoldsFor(weekKey)).filter(([, v]) => v === 'closed').map(([d]) => Number(d)).sort((a, b) => a - b);
}

/** 只保留最近幾週的摺疊狀態（weekKey 是 '2026-W38' 這種，字串排序＝時間排序）。 */
const KEEP_WEEKS = 4;
export async function setCollapsedDay(weekKey, day, on) {
  const all = { ...(get('collapsedDays') ?? {}) };
  const cur = dayFoldsFor(weekKey);
  cur[day] = on ? 'closed' : 'open';
  all[weekKey] = cur;
  for (const k of Object.keys(all).sort().slice(0, -KEEP_WEEKS)) delete all[k];
  await set('collapsedDays', all);
}

const cache = new Map();
let loaded = false;

export async function load() {
  const rows = await db.getAll('settings');
  cache.clear();
  for (const r of rows) cache.set(r.key, r.value);
  loaded = true;
}

export function get(key) {
  if (!loaded) throw new Error('prefs.load() 還沒跑完就讀設定');
  return cache.has(key) ? cache.get(key) : DEFAULTS[key];
}

export async function set(key, value) {
  cache.set(key, value);
  await db.put('settings', { key, value });
}

export function all() {
  const out = { ...DEFAULTS };
  for (const [k, v] of cache) out[k] = v;
  return out;
}

// 標準 17px、大字約 19px、特大約 22px。特大是給看不清楚的長輩用的 ——
// 會去調到特大的人正是最需要看得清楚的人，所以 layouttest 三種字級都要掃過。
const SCALES = { md: 1, lg: 1.12, xl: 1.3 };

/** 把字級套到 <html> 上。 */
export function applyFontScale(scale = get('fontScale')) {
  const root = document.documentElement;
  root.style.setProperty('--font-scale', String(SCALES[scale] ?? 1));
  root.dataset.fontScale = scale;
}

export const FONT_SCALES = ['md', 'lg', 'xl'];
export const FONT_SCALE_LABELS = { md: '標準', lg: '大字', xl: '特大' };

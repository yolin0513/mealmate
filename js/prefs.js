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
  // 這週用的亂數種子；「重新產生」會換一個
  planSeed: null,
};

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

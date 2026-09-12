// hash 路由 + 真實導覽歷史堆疊（沿用 TripQuest／StockDiary 的作法）。
//
// 「返回」＝回到使用者上一個實際造訪的畫面，不是硬寫的父層。

const routes = [];
let notFound = null;
let current = null;

let slowIndicator = null;
export function setSlowIndicator(fn) { slowIndicator = fn; }

let depth = 0;
const trail = [];
const scrollMemory = new Map();
let curRaw = '/';
let restoredScroll = false;

function rememberScroll() { scrollMemory.set(curRaw, window.scrollY); }
export function navRestoredScroll() { return restoredScroll; }

export function route(pattern, handler) {
  const keys = [];
  const rx = new RegExp('^' + pattern.replace(/:[^/]+/g, (m) => { keys.push(m.slice(1)); return '([^/]+)'; }) + '$');
  routes.push({ rx, keys, handler, pattern });
}
export function setNotFound(fn) { notFound = fn; }

/** 這個 App 註冊過的所有路由樣式（給稽核測試用）。 */
export function routePatterns() { return routes.map((r) => r.pattern); }

export function navigate(path, { replace = false } = {}) {
  // 已經過期的 view 不准把使用者拉走（它的 await 回來時使用者可能早就點去別頁了）。
  if (renderIsStale()) return;
  const target = '#' + path;
  const cur = location.hash || '#/';
  if (target === cur) { resolve(); return; }
  if (replace) {
    location.replace(target);
    if (trail.length) trail[trail.length - 1] = path;
  } else {
    location.hash = target;
  }
}

export function back(fallback = '/') {
  if (depth > 0) history.back();
  else navigate(fallback, { replace: true });
}
export function canGoBack() { return depth > 0; }

export function resetHistory(path = '/') {
  trail.length = 0;
  trail.push(path);
  depth = 0;
  const target = '#' + path;
  if ((location.hash || '#/') === target) resolve();
  else location.replace(target);
}

function parse(hash) {
  const raw = (hash ?? location.hash).replace(/^#/, '') || '/';
  const path = raw.split('?')[0];
  const query = Object.fromEntries(new URLSearchParams(raw.split('?')[1] || ''));
  return { raw, path, query };
}

// ---------- 誰有資格畫面上那塊畫布 ----------
//
// 每個 view 都是 async 的：`await import(...)` → `await 讀資料` → `render(...)`。
// 這中間使用者隨時可能換頁。沒有守門的話，**最後畫完的那個贏** —— 網址是新的、
// 畫面是舊的，看起來就是「按了按鈕跳到別頁」。
//
// 守門分兩層：
//   gen      每導覽一次 +1
//   paintGen 目前正在跑的那個 view 是哪一代
// 兩者不相等，就代表正在跑的那個 view 已經過期了，它畫的東西一律不算數。
// 而且同一時間只跑一個 view（runLatest 的迴圈），跑完發現又有人換頁就再跑一次最新的。
let gen = 0;
let paintGen = 0;
let running = false;

export function renderIsStale() { return paintGen !== gen; }

function resolve() {
  const my = ++gen;
  setTimeout(() => { if (slowIndicator && my === gen && paintGen !== my) slowIndicator(); }, 250);
  if (running) return;
  runLatest();
}

async function runLatest() {
  running = true;
  try {
    while (paintGen !== gen) await renderOnce();
  } finally {
    running = false;
  }
}

async function renderOnce() {
  paintGen = gen;
  const my = paintGen;
  const { raw, path, query } = parse();
  const restore = scrollMemory.has(raw) ? scrollMemory.get(raw) : null;
  restoredScroll = restore != null;
  curRaw = raw;

  for (const r of routes) {
    const m = path.match(r.rx);
    if (!m) continue;
    const params = {};
    r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
    current = { path, params, query, pattern: r.pattern };
    if (restore == null) window.scrollTo(0, 0);
    try { await r.handler({ params, query, path, fresh: true }); }
    catch (e) { console.error(e); }
    if (my !== gen) return;
    if (restore != null) {
      window.scrollTo(0, restore);
      requestAnimationFrame(() => { if (my === gen) window.scrollTo(0, restore); });
    }
    return;
  }
  if (notFound) await notFound({ path });
}

/** 重畫目前這一頁。走跟一般導覽同一條路，所以同樣受守門保護。 */
export function refresh() { resolve(); }

export function currentRoute() { return current; }

function onHashChange() {
  const { raw } = parse();
  if (trail.length >= 2 && trail[trail.length - 2] === raw) {
    trail.pop();
    depth = Math.max(0, depth - 1);
  } else if (trail[trail.length - 1] !== raw) {
    trail.push(raw);
    depth += 1;
  }
  resolve();
}

export function startRouter() {
  window.addEventListener('hashchange', onHashChange);
  window.addEventListener('scroll', rememberScroll, { passive: true });
  const { raw } = parse();
  if (!location.hash) { location.replace('#/'); trail.push('/'); }
  else trail.push(raw);
  resolve();
}

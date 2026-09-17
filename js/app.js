// 進入點：路由表、首次說明的守門、Service Worker 換版流程。
//
// **這個檔案只能由 index.html 載入，不准被任何模組 import。**
// index.html 載入的網址帶版本參數（`./js/app.js?v=<版本>`）；用 `'./app.js'` import 它，
// 瀏覽器會當成另一個網址再求值一次 —— boot() 跑兩次、路由註冊兩次。view 要用的東西在 js/shell.js。
// shelltest 有靜態稽核擋這件事。

import { route, setNotFound, startRouter, currentRoute, navigate, setSlowIndicator } from './router.js';
import * as store from './store.js';
import * as prefs from './prefs.js';
import * as db from './db.js';
import { h, modal, toast } from './ui.js';
import { setTop, render, renderLoading, renderTabs, viewIsEmpty } from './shell.js';
import { APP_VERSION, V } from './version.js';

// ---------- 路由 ----------
// 按過「我知道了」之前，任何一頁都導回首次說明（PLAN §1.2 第 1 點）。
const guarded = (fn) => async (ctx) => {
  if (!prefs.get('disclaimerAcceptedAt')) { navigate('/welcome', { replace: true }); return; }
  return fn(ctx);
};
route('/welcome', async () => (await import(`./views/welcome.js${V}`)).default());
route('/', guarded(async ({ query }) => (await import(`./views/week.js${V}`)).default(query)));
route('/today', guarded(async ({ query }) => (await import(`./views/today.js${V}`)).default(query)));
route('/shopping', guarded(async ({ query }) => (await import(`./views/shopping.js${V}`)).default(query)));
route('/recipes', guarded(async ({ query }) => (await import(`./views/recipes.js${V}`)).default(query)));
route('/recipes/new', guarded(async ({ query }) => (await import(`./views/recipeedit.js${V}`)).default({ from: query.from ?? null })));
route('/recipes/:id/edit', guarded(async ({ params }) => (await import(`./views/recipeedit.js${V}`)).default({ id: params.id })));
route('/recipes/:id', guarded(async ({ params }) => (await import(`./views/recipe.js${V}`)).default(params.id)));
route('/family', guarded(async () => (await import(`./views/family.js${V}`)).default()));
route('/family/new', guarded(async () => (await import(`./views/member.js${V}`)).default(null)));
route('/family/:id', guarded(async ({ params }) => (await import(`./views/member.js${V}`)).default(params.id)));

/**
 * 走到一條不認得的路。**絕對不要靜默導回首頁。**
 * 根因幾乎一定是版本混搭：畫面是新版的（所以有那顆按鈕），但正在跑的 app.js 是舊版的。
 */
setNotFound(({ path }) => {
  showVersionMismatch(path);
});

function showVersionMismatch(rawPath) {
  let path = rawPath;
  try { path = decodeURIComponent(rawPath); } catch { /* 編碼壞掉就顯示原樣 */ }
  setTop({ title: '需要更新', back: true });
  const btn = h('button', { class: 'btn btn-primary' }, '更新到最新版');
  btn.addEventListener('click', () => {
    if (btn.disabled) return;
    btn.disabled = true;
    btn.textContent = '更新中…';
    forceUpdate();
  });

  render(
    h('section', { class: 'card', dataset: { card: 'versionMismatch' } },
      h('h2', { class: 'card-title' }, '這個畫面在你目前的版本裡還沒有'),
      h('p', {}, `「${path}」這一頁需要比較新的版本才打得開。`),
      h('p', { class: 'muted sm' },
        '你看到的按鈕來自新版的畫面，但正在執行的程式還是舊的 —— ' +
        '通常是剛更新過、瀏覽器手上還留著一份十分鐘內的舊檔案造成的。'),
      h('p', { class: 'muted sm' }, `目前執行的版本：${APP_VERSION}`),
      btn,
      h('a', { class: 'btn', href: '#/' }, '先回本週'),
      h('p', { class: 'muted sm' },
        '按了更新還是一樣的話：把 App 完全關掉（iPhone 從多工畫面上滑掉）再開一次。'),
    ),
  );

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistration().then((r) => r && r.update()).catch(() => {});
  }
}

async function forceUpdate() {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) {
      await reg.update().catch(() => {});
      if (reg.waiting) {
        reg.waiting.postMessage('SKIP_WAITING');
        await new Promise((r) => setTimeout(r, 1200));
      } else if (navigator.onLine) {
        await reg.unregister().catch(() => {});
      }
    }
  } catch { /* noop */ }
  location.replace(`./?fresh=${Date.now()}#/`);
}

// ---------- 存不進去的時候要講 ----------
//
// 這個 App 沒有伺服器：寫不進 IndexedDB 就是真的沒有了。以前十幾個寫入點沒有一個 catch，
// 失敗時畫面完全不出聲 —— 按鈕彈回去、沒有訊息，使用者會以為存好了。
// db.onWriteError 是唯一的通報口（每個寫入都會經過），所以**新增的寫入點不可能忘記接**。
let tellingWriteFailed = false;
async function tellWriteFailed({ error }) {
  if (tellingWriteFailed) return;        // 一次動作可能連續寫好幾筆，只講一次就夠
  tellingWriteFailed = true;
  const why = String(error?.name || error?.message || error || '不明原因');
  try {
    await modal({
      title: '沒有存起來',
      body: h('div', {},
        h('p', {}, '剛才的變更沒有存進這台裝置。畫面上看到的還在，但關掉 App 之後就會不見。'),
        h('p', { class: 'muted sm' }, '常見原因是裝置空間不夠，或瀏覽器在無痕模式下不讓 App 存資料。清出一點空間、或改用一般視窗開，再做一次。'),
        h('p', { class: 'muted xs' }, `錯誤：${why}`),
      ),
      actions: [{ label: '知道了', value: true, primary: true }],
    });
  } finally { tellingWriteFailed = false; }
}
db.onWriteError(tellWriteFailed);

// 漏網的安全網：任何沒被接住的 Promise 失敗（例如某個按鈕的處理函式自己丟例外）至少要出一句話，
// 不能讓使用者對著一個「按了沒反應」的畫面猜。寫入失敗已經有上面那個對話框，這裡就不重複講。
window.addEventListener('unhandledrejection', (e) => {
  console.error(e.reason);
  if (tellingWriteFailed) return;
  toast('剛才那個動作沒有完成，請再試一次。');
});

// ---------- 啟動 ----------
/** 連資料庫都開不起來時的畫面。停在轉圈圈比講實話更糟 —— 使用者會一直等。 */
function showStorageBlocked(error) {
  const why = String(error?.name || error?.message || error || '不明原因');
  setTop({ title: 'MealMate', back: false });
  const again = h('button', { class: 'btn btn-primary', type: 'button', dataset: { action: 'retryBoot' }, onclick: () => location.reload() }, '再試一次');
  render(
    h('section', { class: 'card', dataset: { card: 'storageBlocked' } },
      h('h2', { class: 'card-title' }, '這台裝置不讓 App 存資料'),
      h('p', {}, 'MealMate 把家人設定與菜單存在這台裝置裡，存不了就沒辦法開始。'),
      h('p', { class: 'muted sm' }, '最常見的原因是用無痕／私密瀏覽開啟，或瀏覽器把這個網站的儲存空間關掉了。改用一般視窗開一次就會好。'),
      h('p', { class: 'muted xs' }, `錯誤：${why}`),
      again,
    ),
  );
}

(async function boot() {
  setSlowIndicator(() => { if (viewIsEmpty()) renderLoading(); });
  renderLoading();
  try {
    await store.init();
  } catch (e) {
    console.error(e);
    showStorageBlocked(e);
    return;
  }
  prefs.applyFontScale();
  startRouter();
  renderTabs();
  void currentRoute;
  // 告訴看門狗（js/bootguard.js）：module 圖整張跑起來了，不必補說明卡。
  document.documentElement.dataset.booted = '1';

  // 資料只在本機；瀏覽器在空間不足時可能清掉。請求持久化（拒絕也沒關係，匯出備份是另一條路）。
  try { navigator.storage?.persist?.().catch(() => {}); } catch { /* noop */ }

  if ('serviceWorker' in navigator) {
    const register = () => navigator.serviceWorker.register('./sw.js').then(setupUpdates).catch(() => {});
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
  }
})();

// ---------- 換版 ----------
const bootAt = Date.now();
const AUTO_KEY = 'mealmate.autoUpdated';
let interacted = false;
for (const ev of ['pointerdown', 'keydown']) {
  window.addEventListener(ev, () => { interacted = true; }, { once: true, passive: true });
}

function appBusy() {
  return !!document.getElementById('modalRoot')?.childElementCount;
}

function canAutoUpdate() {
  try { if (sessionStorage.getItem(AUTO_KEY)) return false; } catch { return false; }
  return !interacted && !appBusy() && Date.now() - bootAt < 12000;
}

function setupUpdates(reg) {
  let applying = false;
  let reloading = false;
  let firstControl = !navigator.serviceWorker.controller;

  const reload = () => { if (!reloading) { reloading = true; location.reload(); } };

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (firstControl) { firstControl = false; return; }
    if (applying || canAutoUpdate()) { reload(); return; }
    showUpdateBar(() => applyNow(null));
  });

  function applyNow(worker) {
    applying = true;
    const w = worker && worker.state === 'installed' ? worker : reg.waiting;
    if (!w) { reload(); return; }
    try { w.postMessage('SKIP_WAITING'); } catch { /* noop */ }
    setTimeout(async () => {
      if (reloading) return;
      try {
        const r = await navigator.serviceWorker.getRegistration();
        if (r && r.waiting) r.waiting.postMessage('SKIP_WAITING');
      } catch { /* noop */ }
      // **這裡以前會先 unregister 再 reload。不可以。**
      // 取消註冊之後這一頁就沒有 Service Worker 了：重載時每一個檔案都只能走網路，
      // 手機網路一不穩，整張 module 圖就載不齊 —— 畫面變成「只有標題列、下面全空」，
      // 而且連快取都沒得退（Yolin 2026-09-17 回報的就是這個畫面）。
      // 新版 SW 早就 skipWaiting 過了，直接重載就好；就算它還沒接手，舊的 SW 仍然供得出整組舊版，
      // 畫面至少是完整可用的，下次再換。
      setTimeout(() => { reload(); }, 1500);
    }, 2500);
  }

  const ready = (worker) => {
    if (canAutoUpdate()) {
      try { sessionStorage.setItem(AUTO_KEY, '1'); } catch { /* noop */ }
      applying = true;
      applyNow(worker);
      return;
    }
    showUpdateBar(() => applyNow(worker));
  };

  if (reg.waiting) ready(reg.waiting);
  reg.addEventListener('updatefound', () => {
    const nw = reg.installing;
    if (!nw) return;
    nw.addEventListener('statechange', () => {
      if (nw.state === 'installed' && navigator.serviceWorker.controller) ready(nw);
    });
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') reg.update().catch(() => {});
  });
}

function showUpdateBar(onApply) {
  if (document.getElementById('updateBar')) return;
  // 寫出目前這一版：使用者說「看不到新功能」時，最快的判斷就是問他畫面上顯示哪一版（2026-09-16 實際遇到）。
  const text = h('span', { class: 'update-text' }, `有新版本（目前 ${APP_VERSION.replace('mealmate-', '')}）`);
  const go = h('button', { class: 'update-go' }, '點一下更新');
  const later = h('button', { class: 'update-later', 'aria-label': '稍後再說', onclick: () => bar.remove() }, '✕');
  const bar = h('div', { id: 'updateBar', class: 'update-bar' }, text, go, later);
  go.addEventListener('click', () => {
    if (bar.dataset.busy) return;
    bar.dataset.busy = '1';
    text.textContent = '更新中…';
    go.textContent = '請稍候';
    go.disabled = true;
    later.remove();
    onApply();
  });
  document.body.append(bar);
}

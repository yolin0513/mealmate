// 畫面外殼：頂列、底部分頁、把一個畫面放上去。
//
// `index.html` 載入的是 `./js/app.js?v=<版本>`。如果 view 再 import '../app.js'（沒帶參數），
// 對瀏覽器來說那是另一個網址，整個 app.js 會被重新求值 —— boot() 跑兩次、路由註冊兩次。
// 所以 app.js 是**只有 index.html 會載入的進入點，不准被任何人 import**，view 要的東西一律放這裡。
// shelltest 有靜態稽核擋著。

import { mount, h, spinnerBox } from './ui.js';
import { back, canGoBack, renderIsStale } from './router.js';

const view = document.getElementById('view');

/**
 * 換頁時只播報「現在是哪一頁」。
 *
 * 以前 aria-live="polite" 掛在 #view 上，每次重畫都把整頁念一遍 —— 換一次頁、按一顆開關、
 * 勾一項買菜清單都會從頭念，長輩用螢幕閱讀器會被洗版。頁名沒變就不播（同一頁的重畫是安靜的）。
 */
let lastAnnounced = null;
function announceRoute(title) {
  const el = document.getElementById('routeAnnounce');
  if (!el || title === lastAnnounced) return;
  lastAnnounced = title;
  el.textContent = title;
}

export function setTop({ title, back: showBack = true, action = null }) {
  // 跟 render() 同一道守門：過期的 view 不准改頂列。
  if (renderIsStale()) return;
  const shown = title || 'MealMate';
  document.getElementById('topTitle').textContent = shown;
  announceRoute(shown);
  const backBtn = document.getElementById('backBtn');
  backBtn.hidden = !showBack || !canGoBack();
  const actionBtn = document.getElementById('topActionBtn');
  if (action) {
    actionBtn.hidden = false;
    actionBtn.textContent = action.label;
    actionBtn.setAttribute('aria-label', action.aria || action.label);
    actionBtn.onclick = action.onclick;
  } else {
    actionBtn.hidden = true;
    actionBtn.onclick = null;
  }
}

/**
 * 把一個畫面放上去 —— 除非它已經過期了。
 * 這裡不畫不是把錯誤吞掉：router 的 runLatest 迴圈接著就會把使用者真正要的那一頁畫出來。
 */
export function render(...nodes) {
  if (renderIsStale()) return;
  mount(view, ...nodes);
  renderTabs();
}

export function renderLoading(text = '載入中…') { mount(view, spinnerBox(text)); }

export function viewIsEmpty() { return !view.firstChild; }

// ---------- 底部分頁 ----------
const TABS = [
  { icon: '📅', label: '本週', path: '/' },
  { icon: '🧺', label: '買菜', path: '/shopping' },
  { icon: '🍲', label: '食譜', path: '/recipes' },
  { icon: '👨‍👩‍👧', label: '家人', path: '/family' },
];

export function currentPath() { return (location.hash.replace(/^#/, '') || '/').split('?')[0]; }

/** 這條路徑屬於哪個分頁（子頁面也要亮對應的分頁，例如 /recipes/xxx → 食譜）。 */
function tabFor(path) {
  if (path === '/') return '/';
  return TABS.map((t) => t.path).filter((p) => p !== '/').find((p) => path === p || path.startsWith(p + '/')) ?? null;
}

export function renderTabs() {
  const bar = document.getElementById('tabbar');
  const here = tabFor(currentPath());
  mount(bar, ...TABS.map((t) => {
    const on = here === t.path;
    return h('a', {
      class: 'tab' + (on ? ' on' : ''),
      href: `#${t.path}`,
      'aria-current': on ? 'page' : null,
    }, h('span', { class: 'tab-icon', 'aria-hidden': 'true' }, t.icon), h('span', { class: 'tab-label' }, t.label));
  }));
}

window.addEventListener('hashchange', renderTabs);
document.getElementById('backBtn').addEventListener('click', () => back('/'));

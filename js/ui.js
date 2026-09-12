// DOM / UI 小工具（沿用 TripQuest／StockDiary 的作法）。
//
// 兩條不可退讓的規則：
//   1. h() 的 children 一律走 document.createTextNode —— 沒有任何路徑會把字串當 HTML 解析。
//      h() 沒有、也不會有 `html:` prop。要顯示什麼就傳字串，它就只是字。
//   2. 網址屬性走白名單，javascript: / data:text 之類進不來。
//
// 數字的規則：**拿不到的一律顯示「—」或「未估算」，永遠不顯示 0 冒充。**

const SAFE_URL = /^(https?:|blob:|mailto:|tel:|#|\.?\/|data:image\/)/i;
const URL_ATTRS = new Set(['href', 'src', 'xlink:href', 'formaction', 'action', 'poster']);

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (URL_ATTRS.has(k)) {
      if (SAFE_URL.test(String(v).trim())) el.setAttribute(k, v);
    } else if (k in el && k !== 'list') el[k] = v;
    else el.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
export function mount(node, ...children) { clear(node); node.append(...children.flat().filter(Boolean)); }

let toastTimer = null;
export function toast(msg, ms = 2400) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => { el.hidden = true; }, 250);
  }, ms);
}

export function modal({ title, body, actions, closeX = false }) {
  const root = document.getElementById('modalRoot');
  return new Promise((resolve) => {
    const close = (val) => { overlay.remove(); document.removeEventListener('keydown', onKey); resolve(val); };
    const onKey = (e) => { if (e.key === 'Escape') close(null); };
    const card = h('div', { class: 'modal-card', role: 'dialog', 'aria-modal': 'true' },
      closeX ? h('button', { class: 'modal-x', 'aria-label': '關閉', onclick: () => close(null) }, '✕') : null,
      title ? h('h2', { class: 'modal-title' }, title) : null,
      h('div', { class: 'modal-body' }, body),
      h('div', { class: 'modal-actions' },
        ...(actions || [{ label: '好', value: true, primary: true }]).map((a) =>
          h('button', {
            class: 'btn' + (a.primary ? ' btn-primary' : '') + (a.danger ? ' btn-danger' : ''),
            onclick: () => close(a.value),
          }, a.label)
        )
      )
    );
    const overlay = h('div', { class: 'modal-overlay', onclick: (e) => { if (e.target === overlay) close(null); } }, card);
    root.append(overlay);
    document.addEventListener('keydown', onKey);
    const focusable = card.querySelector('input, textarea, button.btn-primary, button');
    if (focusable) setTimeout(() => focusable.focus(), 30);
  });
}

export async function confirmDialog(message, { danger = false, okLabel = '確定', cancelLabel = '取消' } = {}) {
  return modal({
    body: h('p', { style: 'white-space:pre-line' }, message),
    actions: [
      { label: cancelLabel, value: false },
      { label: okLabel, value: true, primary: !danger, danger },
    ],
  });
}

// 等待中的畫面一定要有字。只有一顆轉圈圈，使用者會以為當掉了。
export function spinnerBox(text, sub = '') {
  return h('div', { class: 'wait-box' },
    h('div', { class: 'spinner' }),
    h('p', { class: 'wait-text' }, text),
    sub ? h('p', { class: 'muted sm' }, sub) : null,
  );
}

/** 小標籤（圓角 pill）。tone：'' | 'green' | 'yellow' | 'accent' | 'muted' */
export function pill(text, tone = '') {
  return h('span', { class: 'pill' + (tone ? ` pill-${tone}` : '') }, text);
}

/**
 * 切換開關（軌道＋滑塊；role="switch"，整塊可按，觸控區 ≥ 44px）。
 * @param onChange 收到新的布林值。回傳 Promise 也可以，切換時會先鎖住避免連點。
 */
export function switchRow({ label, hint, checked, onChange, key = null }) {
  const knob = h('span', { class: 'switch-knob' });
  const track = h('span', { class: 'switch-track' }, knob);
  const sw = h('button', {
    class: 'switch' + (checked ? ' on' : ''),
    type: 'button',
    role: 'switch',
    'aria-checked': checked ? 'true' : 'false',
    'aria-label': label,
    dataset: key ? { pref: key } : {},
  }, track, h('span', { class: 'switch-state' }, checked ? '開' : '關'));

  let busy = false;
  const toggle = async () => {
    if (busy) return;
    busy = true;
    try { await onChange(!checked); } finally { busy = false; }
  };
  sw.addEventListener('click', toggle);

  return h('div', { class: 'pref-row' },
    h('div', { class: 'pref-main' },
      h('p', { class: 'pref-label' }, label),
      hint ? h('p', { class: 'muted sm' }, hint) : null),
    sw);
}

// ---------- 數字 ----------
//
// 拿不到的數字一律顯示 NO_VALUE；營養值另有 fmtEst()：
// 有值 → 「估 42 g」這種帶「估」字的字串；null → 「未估算」。
// 「未估算」不是 0 —— 對長輩來說「這道菜鈉 0」是一句假話。

export const NO_VALUE = '—';
export const NOT_ESTIMATED = '未估算';

/** 一般數字：null → '—'。digits 是小數位數。 */
export function fmtNum(n, digits = 0) {
  if (n == null || !Number.isFinite(n)) return NO_VALUE;
  return n.toLocaleString('zh-Hant-TW', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** 營養估計值：null → '未估算'；有值 → '估 42 g'。 */
export function fmtEst(n, unit = '', digits = 0) {
  if (n == null || !Number.isFinite(n)) return NOT_ESTIMATED;
  return `估 ${fmtNum(n, digits)}${unit ? ' ' + unit : ''}`;
}

/** 數字節點：畫面上每一個估計值都包在 .num 裡，測試靠這個 class 找得到它們。 */
export function num(text, extraClass = '') {
  return h('span', { class: 'num' + (extraClass ? ' ' + extraClass : '') }, text);
}

// 衛教引用句（data/edu.json）。
//
// UI 裡任何一句衛教文字都要透過 edu(id) 拿，不准直接寫在程式碼裡 ——
// 這樣每一句都有來源（機關、標題、版本、網址、擷取日），edutest 會掃 js/ 裡所有
// edu('…') 的 id 是否存在，也會檢查逐字引用能在 docs/sources/ 找到原文。

import { h } from './ui.js';
import * as store from './store.js';

/** 拿一筆引用；不存在回 null（edutest 保證內建 id 都存在）。 */
export function edu(id) {
  return store.eduEntry(id);
}

/** 只要文字。不存在回空字串，不會丟錯讓整頁掛掉。 */
export function eduText(id) {
  return edu(id)?.text ?? '';
}

/** 一段引用 ＋ 一行來源。kind=summary 會標「摘要」，讓人看得出不是原文。 */
export function eduNode(id) {
  const e = edu(id);
  if (!e) return h('p', { class: 'muted sm' }, '（衛教引用尚未取得）');
  const s = e.source ?? {};
  const label = e.kind === 'quote' ? '原文' : e.kind === 'summary' ? '摘要自' : '來源';
  return h('div', { class: 'edu', dataset: { edu: id } },
    h('p', {}, e.kind === 'quote' ? `「${e.text}」` : e.text),
    h('p', { class: 'muted xs' },
      `${label}：${s.org ?? ''}《${s.title ?? ''}》${s.version ? '，' + s.version : ''}${s.fetchedAt ? '，' + s.fetchedAt + ' 擷取' : ''} `,
      s.url ? h('a', { href: s.url, target: '_blank', rel: 'noopener' }, '開原文') : null),
  );
}

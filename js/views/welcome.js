// 首次啟動的一頁說明（PLAN §1.2 第 1 點）。按「我知道了」之前，其他頁面都會被導回這裡。
// 同一段文字常駐在「家人」分頁底部。

import { h, pill } from '../ui.js';
import { setTop, render } from '../shell.js';
import { navigate } from '../router.js';
import * as prefs from '../prefs.js';

export const NOTICE_LINES = [
  '一、營養數字是依食藥署資料庫估算的，會跟你實際煮出來的有差；每個數字前面都有「估」字，點開可以看是怎麼算的。',
  '二、家人的慢性病留意設定，只會決定畫面上顯示哪幾個數字、以及排菜時的先後順序。它不是醫囑。',
  '三、長輩實際怎麼吃，請以醫師或營養師的指示為準。',
];

export function noticeCard() {
  return h('section', { class: 'card notice', dataset: { card: 'healthNotice' } },
    h('strong', {}, '先說清楚三件事'),
    ...NOTICE_LINES.map((t) => h('p', {}, t)),
    h('div', { class: 'pill-row' }, pill('純本機儲存', 'green'), pill('無帳號、無上傳', 'green')),
  );
}

export default async function welcomeView() {
  setTop({ title: '開始之前', back: false });
  const accepted = !!prefs.get('disclaimerAcceptedAt');
  const btn = h('button', { class: 'btn btn-primary', dataset: { action: 'acceptDisclaimer' } }, accepted ? '回本週' : '我知道了');
  btn.addEventListener('click', async () => {
    if (btn.disabled) return;
    btn.disabled = true;
    if (!accepted) await prefs.set('disclaimerAcceptedAt', new Date().toISOString());
    navigate('/', { replace: true });
  });
  render(
    h('section', { class: 'card hero', dataset: { card: 'welcome' } },
      h('h2', {}, 'MealMate 家庭三餐規劃'),
      h('p', {}, '幫你排一週菜單、整理購物清單；素葷可以一鍋兩吃。'),
    ),
    noticeCard(),
    h('section', { class: 'card' },
      btn,
      h('p', { class: 'muted xs' }, '這段說明之後在「家人」分頁底部隨時看得到。'),
    ),
  );
}

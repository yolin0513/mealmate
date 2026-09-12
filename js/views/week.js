// 本週菜單（首頁）。M1：顯示家人與買菜日的設定狀態；M2 接上週計畫。

import { h, pill } from '../ui.js';
import { setTop, render } from '../shell.js';
import * as store from '../store.js';
import * as prefs from '../prefs.js';
import { DIET_LABELS } from '../members.js';

const DAY_NAMES = ['日', '一', '二', '三', '四', '五', '六'];

export default async function weekView() {
  setTop({ title: '本週菜單', back: false });
  const members = store.members();
  const days = prefs.get('shoppingDays') ?? [];
  const wants = store.wantThisWeekIds();

  const membersLine = members.length
    ? `已新增 ${members.length} 位：${members.map((m) => `${m.name}（${DIET_LABELS[m.diet]}）`).join('、')}`
    : '幾個人吃、誰吃素、誰有要留意的慢性病';
  const daysLine = days.length ? `星期${[...days].sort().map((d) => DAY_NAMES[d]).join('、')}買菜` : '一週買幾次、星期幾買';

  const hero = h('section', { class: 'card hero', dataset: { card: 'weekEmpty' } },
    h('h2', {}, '這一週吃什麼，交給 MealMate 排'),
    h('p', {}, '設定家人與買菜日之後，一鍵產生一週菜單：主菜兩週內不重複、素葷可以一鍋兩吃、購物清單依買菜日自動整理。'),
    h('ol', { class: 'steps' },
      h('li', {}, h('span', { class: 'step-no' }, members.length ? '✓' : '1'),
        h('div', {}, h('p', { class: 'row-title' }, '新增家人'), h('p', { class: 'muted sm' }, membersLine))),
      h('li', {}, h('span', { class: 'step-no' }, days.length ? '✓' : '2'),
        h('div', {}, h('p', { class: 'row-title' }, '選買菜日'), h('p', { class: 'muted sm' }, daysLine))),
      h('li', {}, h('span', { class: 'step-no' }, '3'),
        h('div', {}, h('p', { class: 'row-title' }, '產生本週菜單'), h('p', { class: 'muted sm' }, '這一版尚未開放；可以先在食譜頁收藏、勾「本週想吃」，產生時會優先排進來。'))),
    ),
    h('div', { class: 'btn-row' },
      h('a', { class: 'btn btn-primary', href: '#/family' }, members.length ? '調整家人與買菜日' : '去設定家人'),
      h('a', { class: 'btn', href: '#/recipes' }, '翻翻食譜'),
    ),
  );

  const wantCard = wants.length
    ? h('section', { class: 'card', dataset: { card: 'wantThisWeek' } },
      h('h2', { class: 'card-title' }, `本週想吃（${wants.length}）`),
      h('div', { class: 'list' }, ...wants.map((id) => {
        const r = store.recipeById(id);
        return r ? h('a', { class: 'row', href: `#/recipes/${r.id}` }, h('div', { class: 'row-main' }, h('p', { class: 'row-title' }, r.name)), h('div', { class: 'row-side' }, `約 ${r.time} 分`)) : null;
      })),
    )
    : null;

  render(hero, wantCard, h('section', { class: 'card' },
    h('div', { class: 'pill-row' }, pill('純本機儲存', 'green'), pill('無帳號、無上傳', 'green')),
    h('p', { class: 'muted sm' }, '營養數字都是估計值、前面有「估」字；慢性病設定只影響顯示與排序，不是醫囑。完整說明在「家人」分頁底部。'),
  ));
}

// 本週菜單（首頁）。M0：還沒有規劃功能，畫「開始使用」與健康說明；M2 接上週計畫。

import { h, pill } from '../ui.js';
import { setTop, render } from '../shell.js';
import * as store from '../store.js';

export default async function weekView() {
  setTop({ title: '本週菜單', back: false });
  const members = await store.members();

  const hero = h('section', { class: 'card hero', dataset: { card: 'weekEmpty' } },
    h('h2', {}, '這一週吃什麼，交給 MealMate 排'),
    h('p', {}, '設定家人與買菜日之後，一鍵產生一週菜單：主菜兩週內不重複、素葷可以一鍋兩吃、購物清單依買菜日自動整理。'),
    h('ol', { class: 'steps' },
      h('li', {}, h('span', { class: 'step-no' }, '1'),
        h('div', {}, h('p', { class: 'row-title' }, '新增家人'),
          h('p', { class: 'muted sm' }, members.length ? `已新增 ${members.length} 位` : '幾個人吃、誰吃素、誰有要留意的慢性病'))),
      h('li', {}, h('span', { class: 'step-no' }, '2'),
        h('div', {}, h('p', { class: 'row-title' }, '選買菜日'), h('p', { class: 'muted sm' }, '一週買幾次、星期幾買'))),
      h('li', {}, h('span', { class: 'step-no' }, '3'),
        h('div', {}, h('p', { class: 'row-title' }, '產生本週菜單'), h('p', { class: 'muted sm' }, '這一版尚未開放，先可以翻食譜'))),
    ),
    h('div', { class: 'btn-row' },
      h('a', { class: 'btn btn-primary', href: '#/family' }, '去設定家人'),
      h('a', { class: 'btn', href: '#/recipes' }, '先翻翻食譜'),
    ),
  );

  const notice = h('section', { class: 'card notice', dataset: { card: 'healthNotice' } },
    h('strong', {}, '先說清楚三件事'),
    h('p', {}, '一、營養數字是依食藥署資料庫估算的，會跟你實際煮出來的有差；每個數字前面都有「估」字，點開可以看是怎麼算的。'),
    h('p', {}, '二、家人的慢性病留意設定，只會決定畫面上顯示哪幾個數字、以及排菜時的先後順序。它不是醫囑。'),
    h('p', {}, '三、長輩實際怎麼吃，請以醫師或營養師的指示為準。'),
    h('div', { class: 'pill-row' }, pill('純本機儲存', 'green'), pill('無帳號、無上傳', 'green')),
  );

  render(hero, notice);
}

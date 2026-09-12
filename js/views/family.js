// 家人：成員、買菜日（M1）；關於與資料來源（M0 就要有——資料授權要求標示來源）。

import { h } from '../ui.js';
import { setTop, render } from '../shell.js';
import * as store from '../store.js';
import { eduNode } from '../edu.js';
import { APP_VERSION } from '../version.js';

export default async function familyView() {
  setTop({ title: '家人', back: false });
  const members = await store.members();
  const meta = store.recipesMeta();

  const membersCard = h('section', { class: 'card', dataset: { card: 'membersEmpty' } },
    h('h2', { class: 'card-title' }, '家人'),
    members.length
      ? h('p', {}, `已新增 ${members.length} 位`)
      : h('p', { class: 'muted' }, '還沒有新增家人。下一版會在這裡新增成員：年齡層、飲食型態（葷／蛋奶素／全素／全素不含五辛）、要留意的慢性病項目、質地與過敏原。'),
  );

  const shoppingCard = h('section', { class: 'card', dataset: { card: 'shoppingDays' } },
    h('h2', { class: 'card-title' }, '買菜日'),
    h('p', { class: 'muted' }, '下一版會在這裡勾星期幾買菜；購物清單會依此分成幾張。'),
  );

  const about = h('section', { class: 'card', dataset: { card: 'about' } },
    h('h2', { class: 'card-title' }, '關於與資料來源'),
    h('p', { dataset: { field: 'appVersion' } }, `MealMate 家庭三餐規劃 · 版本 ${APP_VERSION}`),
    h('p', { class: 'muted sm' }, `內建食譜 ${meta ? meta.count : '—'} 道；食材營養資料版本 ${store.foodsVersion() ?? '尚未取得'}。`),
    eduNode('fda.tfnd.attribution'),
    eduNode('hpa.open-data.attribution'),
    h('div', { class: 'notice' },
      h('strong', {}, '這個 App 不是什麼'),
      h('p', {}, '不是醫療器材、不是營養處方。慢性病的留意設定只影響顯示與排序；長輩實際怎麼吃，請以醫師或營養師的指示為準。'),
      h('p', {}, '所有資料只存在這台裝置；沒有帳號、沒有上傳、沒有任何外部連線。'),
    ),
    h('p', { class: 'muted xs' }, '純前端 PWA，原始碼公開於 GitHub（yolin0513/mealmate）。'),
  );

  render(membersCard, shoppingCard, about);
}

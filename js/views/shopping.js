// 買菜（購物清單）。M0：尚無清單；M3 接上採買區間與彙整。

import { h } from '../ui.js';
import { setTop, render } from '../shell.js';

export default async function shoppingView() {
  setTop({ title: '買菜', back: false });
  render(
    h('section', { class: 'card', dataset: { card: 'shoppingEmpty' } },
      h('h2', { class: 'card-title' }, '還沒有購物清單'),
      h('p', { class: 'muted' }, '產生本週菜單之後，這裡會依你的買菜日分成幾張清單：同一種食材跨餐加總、換成「約幾顆、幾把」、依賣場分區排好；油鹽醬油這類常備品另外列。'),
      h('p', { class: 'muted sm' }, '這一版尚未開放。'),
      h('a', { class: 'btn', href: '#/' }, '回本週'),
    ),
  );
}

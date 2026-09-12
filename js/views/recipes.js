// 食譜清單：搜尋菜名／食材、篩選 chip。

import { h, pill } from '../ui.js';
import { setTop, render } from '../shell.js';
import * as store from '../store.js';
import { ROLE_LABELS, VEG_MODE_LABELS, TEXTURE_LABELS } from '../recipeschema.js';

const FILTERS = [
  { key: 'all', label: '全部', test: () => true },
  { key: 'veg', label: '素', test: (r) => r.vegMode === 'nativeVeg' },
  { key: 'split', label: '可分流', test: (r) => r.vegMode === 'splittable' },
  { key: 'meat', label: '葷', test: (r) => r.vegMode === 'meatOnly' },
  { key: 'quick', label: '20 分內', test: (r) => r.time <= 20 },
  { key: 'soft', label: '軟質', test: (r) => r.texture !== 'normal' },
];

export function vegTone(vegMode) {
  return vegMode === 'nativeVeg' ? 'green' : vegMode === 'splittable' ? 'yellow' : 'accent';
}

export function matchesQuery(recipe, q) {
  const s = String(q ?? '').trim();
  if (!s) return true;
  if (recipe.name.includes(s)) return true;
  return recipe.ingredients.some((ing) => ing.label.includes(s));
}

export default async function recipesView(query = {}) {
  setTop({ title: '食譜', back: false });
  const err = store.dataError('recipes.json');
  if (err) {
    render(h('section', { class: 'card', dataset: { card: 'recipesError' } },
      h('h2', { class: 'card-title' }, '食譜資料尚未取得'),
      h('p', { class: 'muted' }, `讀不到內建食譜（${err}）。離線第一次開啟前需要先連過一次網路。`)));
    return;
  }
  const all = store.recipes();
  let filter = FILTERS.find((f) => f.key === query.f) ?? FILTERS[0];
  let q = query.q ?? '';

  const input = h('input', { class: 'field', type: 'search', placeholder: '找菜名或食材，例如：豆腐', value: q, 'aria-label': '搜尋食譜' });
  const chips = h('div', { class: 'chip-row', role: 'group', 'aria-label': '篩選' });
  const list = h('div', { class: 'list', dataset: { list: 'recipes' } });
  const count = h('p', { class: 'muted sm' });

  const draw = () => {
    const rows = all.filter((r) => filter.test(r) && matchesQuery(r, q));
    count.textContent = `${rows.length} 道${rows.length !== all.length ? `（共 ${all.length} 道）` : ''}`;
    list.replaceChildren(...(rows.length ? rows.map(rowFor) : [h('p', { class: 'muted' }, '沒有符合的食譜。換個字試試，或清掉篩選。')]));
    chips.replaceChildren(...FILTERS.map((f) => h('button', {
      class: 'chip' + (f === filter ? ' on' : ''), type: 'button', 'aria-pressed': f === filter ? 'true' : 'false',
      onclick: () => { filter = f; draw(); },
    }, f.label)));
  };
  input.addEventListener('input', () => { q = input.value; draw(); });
  draw();

  render(
    h('section', { class: 'card', dataset: { card: 'recipeSearch' } }, input, chips, count),
    h('section', { class: 'card', dataset: { card: 'recipeList' } }, list),
  );
}

function rowFor(r) {
  return h('a', { class: 'row', href: `#/recipes/${r.id}`, dataset: { recipe: r.id } },
    h('div', { class: 'row-main' },
      h('p', { class: 'row-title' }, r.name),
      h('div', { class: 'pill-row' },
        pill(ROLE_LABELS[r.role]),
        pill(VEG_MODE_LABELS[r.vegMode], vegTone(r.vegMode)),
        r.texture !== 'normal' ? pill(TEXTURE_LABELS[r.texture]) : null,
      )),
    h('div', { class: 'row-side' }, `約 ${r.time} 分`),
  );
}

// 食譜清單：搜尋菜名／食材、篩選 chip、「誰要吃」、家人的留意欄位。

import { h, pill, fmtNutrient } from '../ui.js';
import { setTop, render } from '../shell.js';
import * as store from '../store.js';
import { ROLE_LABELS, VEG_MODE_LABELS, VEG_MODE_SHORT, TEXTURE_LABELS, timeText } from '../recipeschema.js';
import { NUTRIENT_LABELS } from '../foods.js';
import { estimate } from '../nutrition.js';
import { versionFor, familyWatchFields, DIETS, DIET_LABELS } from '../members.js';

export function vegTone(vegMode) {
  return vegMode === 'nativeVeg' ? 'green' : vegMode === 'splittable' ? 'yellow' : 'accent';
}

export function matchesQuery(recipe, q) {
  const s = String(q ?? '').trim();
  if (!s) return true;
  if (recipe.name.includes(s)) return true;
  return recipe.ingredients.some((ing) => ing.label.includes(s));
}

/** 一道菜對某個「誰要吃」的版本：'all' | 'veg' | 'meat' | null（吃不了）。eater 是 'diet:x' 或 'member:id' 或 ''。 */
export function versionForEater(recipe, eater) {
  if (!eater) return recipe.vegMode === 'splittable' ? 'meat' : 'all';
  if (eater.startsWith('diet:')) return versionFor(recipe, eater.slice(5));
  if (eater.startsWith('member:')) {
    const m = store.memberById(eater.slice(7));
    return m ? versionFor(recipe, m.diet) : (recipe.vegMode === 'splittable' ? 'meat' : 'all');
  }
  return recipe.vegMode === 'splittable' ? 'meat' : 'all';
}

/** 「較低」的門檻：池子裡有值的每份估計值的中位數。沒有兩道以上有值就回 null（沒東西可比）。 */
export function medianOf(values) {
  const v = values.filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length < 2) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

const KIND_FILTERS = [
  { key: 'all', label: '全部', test: () => true },
  { key: 'veg', label: '素', test: (r) => r.vegMode === 'nativeVeg' },
  { key: 'split', label: '可分流', test: (r) => r.vegMode === 'splittable' },
  { key: 'meat', label: '葷', test: (r) => r.vegMode === 'meatOnly' },
  { key: 'mine', label: '我的', test: (r) => r.source === 'user' },
  { key: 'fav', label: '收藏', test: (r) => store.isFavorite(r.id) },
  // 本週想吃不再順便收藏，所以要有自己的篩選（不然只勾了本週想吃的菜，找不到地方取消）
  { key: 'want', label: '本週想吃', test: (r) => store.wantThisWeekIds().includes(r.id) },
];
const NEED_FILTERS = [
  { key: 'quick', label: '20 分內', test: (r) => r.time <= 20 },
  { key: 'soft', label: '軟質', test: (r) => r.texture !== 'normal' },
  { key: 'season', label: '當季', test: (r) => r.season.length === 0 || r.season.includes(new Date().getMonth() + 1) },
  { key: 'lowCarb', label: '醣較低', test: (r, ctx) => ctx.medians.carb != null && ctx.per(r)?.carb != null && ctx.per(r).carb < ctx.medians.carb },
  { key: 'lowSodium', label: '鈉較低', test: (r, ctx) => ctx.medians.sodium != null && ctx.per(r)?.sodium != null && ctx.per(r).sodium < ctx.medians.sodium },
];

export default async function recipesView(query = {}) {
  setTop({ title: '食譜', back: false, action: { label: '＋', aria: '新增食譜', onclick: () => { location.hash = '#/recipes/new'; } } });
  const err = store.dataError('recipes.json');
  if (err) {
    render(h('section', { class: 'card', dataset: { card: 'recipesError' } },
      h('h2', { class: 'card-title' }, '食譜資料尚未取得'),
      h('p', { class: 'muted' }, `讀不到內建食譜（${err}）。離線第一次開啟前需要先連過一次網路。`)));
    return;
  }
  const idx = store.foodsIndex();
  const members = store.members();
  const watch = familyWatchFields(members);
  const all = store.allRecipes();

  let kind = KIND_FILTERS.find((f) => f.key === query.f) ?? KIND_FILTERS[0];
  const needs = new Set();
  let eater = query.eater ?? '';
  let q = query.q ?? '';

  const perCache = new Map();
  const per = (r) => {
    const key = `${r.id}|${eater}`;
    if (!perCache.has(key)) {
      const v = versionForEater(r, eater);
      perCache.set(key, v && idx ? estimate(r, idx, { version: v }).perServing : null);
    }
    return perCache.get(key);
  };
  const ctx = { per, medians: {} };
  const recomputeMedians = () => {
    perCache.clear();
    ctx.medians = { carb: medianOf(all.map((r) => per(r)?.carb)), sodium: medianOf(all.map((r) => per(r)?.sodium)) };
  };
  recomputeMedians();

  const input = h('input', { class: 'field', type: 'search', placeholder: '找菜名或食材，例如：豆腐', value: q, 'aria-label': '搜尋食譜' });
  const eaterOptions = [{ value: '', label: '誰要吃：不限' }];
  for (const m of members) eaterOptions.push({ value: `member:${m.id}`, label: `${m.name}（${DIET_LABELS[m.diet]}）可吃` });
  for (const d of DIETS.filter((x) => x !== 'omni')) eaterOptions.push({ value: `diet:${d}`, label: `${DIET_LABELS[d]}可吃` });
  const eaterSel = h('select', { class: 'field', 'aria-label': '誰要吃', dataset: { field: 'eater' } },
    ...eaterOptions.map((o) => h('option', { value: o.value, selected: o.value === eater ? 'selected' : null }, o.label)));
  eaterSel.addEventListener('change', () => { eater = eaterSel.value; recomputeMedians(); draw(); });

  const kindChips = h('div', { class: 'chip-row', role: 'group', 'aria-label': '種類' });
  const needChips = h('div', { class: 'chip-row', role: 'group', 'aria-label': '需求' });
  const list = h('div', { class: 'list', dataset: { list: 'recipes' } });
  const count = h('p', { class: 'muted sm', dataset: { field: 'recipeCount' } });

  const draw = () => {
    const rows = all.filter((r) => kind.test(r) && [...needs].every((k) => NEED_FILTERS.find((f) => f.key === k).test(r, ctx))
      && (!eater || versionForEater(r, eater) !== null) && matchesQuery(r, q));
    count.textContent = `${rows.length} 道${rows.length !== all.length ? `（共 ${all.length} 道）` : ''}`
      + (needs.has('lowCarb') && ctx.medians.carb != null ? `；醣較低＝每份低於 ${Math.round(ctx.medians.carb)} g（這個池子的中位數）` : '')
      + (needs.has('lowSodium') && ctx.medians.sodium != null ? `；鈉較低＝每份低於 ${Math.round(ctx.medians.sodium)} mg（中位數）` : '');
    list.replaceChildren(...(rows.length ? rows.map((r) => rowFor(r, watch, per(r), idx)) : [h('p', { class: 'muted' }, '沒有符合的食譜。換個字試試，或清掉篩選。')]));
    kindChips.replaceChildren(...KIND_FILTERS.map((f) => h('button', {
      class: 'chip' + (f === kind ? ' on' : ''), type: 'button', 'aria-pressed': f === kind ? 'true' : 'false', dataset: { filter: f.key },
      onclick: () => { kind = f; draw(); },
    }, f.label)));
    needChips.replaceChildren(...NEED_FILTERS.map((f) => h('button', {
      class: 'chip' + (needs.has(f.key) ? ' on' : ''), type: 'button', 'aria-pressed': needs.has(f.key) ? 'true' : 'false', dataset: { filter: f.key },
      onclick: () => { if (needs.has(f.key)) needs.delete(f.key); else needs.add(f.key); draw(); },
    }, f.label)));
  };
  input.addEventListener('input', () => { q = input.value; draw(); });
  draw();

  render(
    h('section', { class: 'card', dataset: { card: 'recipeSearch' } }, input, eaterSel, kindChips, needChips, count),
    h('section', { class: 'card', dataset: { card: 'recipeList' } }, list),
  );
}

function rowFor(r, watch, perServing, idx) {
  const units = idx?.units ?? {};
  const watchLine = watch.length && perServing
    // 分隔用的空白不可以放在 span 裡面：span 是 white-space:nowrap，行首那個空白就不是斷行點，
    // 整行變成一個不可斷的長字串，在 390px 手機上直接被切出畫面外（layouttest 抓到的）。
    // 改成 flex ＋ gap，讓每個欄位自己是一塊、可以換行。
    // 欄位名可以斷行、數值本身不可以斷（「估 9.9 g」拆成兩行會看成兩個數字）。
    // 整段 nowrap 的話，特大字級下「碳水化合物（醣） 估 9.9 g」會比整欄還寬，壓到右邊的「約 20 分」。
    ? h('p', { class: 'muted xs watch-line' }, ...watch.slice(0, 3).map((k) => h('span', { class: 'num', dataset: { nutrient: k } },
      h('span', { class: 'wl-k' }, `${NUTRIENT_LABELS[k]} `), h('span', { class: 'wl-v' }, fmtNutrient(perServing[k], units[k])))))
    : null;
  return h('a', { class: 'row', href: `#/recipes/${r.id}`, dataset: { recipe: r.id } },
    h('div', { class: 'row-main' },
      h('p', { class: 'row-title' }, store.isFavorite(r.id) ? '♥ ' : '', r.name),
      h('div', { class: 'pill-row' },
        pill(ROLE_LABELS[r.role]),
        // 清單用短標籤（詳情頁才寫全）：「可分流（一鍋兩吃）」在窄螢幕大字下會比整欄還寬
        pill(VEG_MODE_SHORT[r.vegMode], vegTone(r.vegMode)),
        r.texture !== 'normal' ? pill(TEXTURE_LABELS[r.texture]) : null,
        r.source === 'user' ? pill('我的', 'accent') : null,
        r.tags?.includes('unresolved') ? pill('部分估算', 'yellow') : null,
      ),
      watchLine,
    ),
    h('div', { class: 'row-side' }, timeText(r.time, { short: true })),
  );
}

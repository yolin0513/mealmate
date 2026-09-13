// 本週頁的操作：換一道、指定、鎖定、把一格重排。跟畫面分開，好測、好讀。

import { h, modal } from '../ui.js';
import * as store from '../store.js';
import * as prefs from '../prefs.js';
import { swapItem, assignItem, daysBetween, MEAL_ROLES } from '../planner.js';
import { ROLE_LABELS } from '../recipeschema.js';
import { versionFor, DIET_LABELS } from '../members.js';
import { matchesQuery } from './recipes.js';

function planArgs() {
  return {
    recipes: store.allRecipes(), members: store.members(), idx: store.foodsIndex(), units: store.units(),
    rules: { noRepeatDays: prefs.get('noRepeatDays'), avoid: prefs.get('avoid') },
    favorites: store.favoritesList(), shoppingDays: prefs.get('shoppingDays') ?? [], seed: prefs.get('planSeed') ?? 'mealmate',
  };
}

async function pastHistory(plan) {
  return (await store.history()).filter((row) => row.date < plan.monday && daysBetween(row.date, plan.monday) <= 28);
}

/** 換一道：排除現在這道，用同一套規則再挑一道。回 true 表示有換到。 */
export async function swapSlotItem({ plan, slotIndex, pos }) {
  const next = swapItem({ plan, slotIndex, pos, history: await pastHistory(plan), ...planArgs() });
  if (!next) return false;
  const slot = plan.slots[slotIndex];
  slot.items = [...slot.items.filter((it) => it.pos !== pos), next].sort((a, b) => a.pos - b.pos);
  await store.savePlan(plan);
  return true;
}

export async function toggleLock({ plan, slotIndex, pos }) {
  const slot = plan.slots[slotIndex];
  const it = slot.items.find((x) => x.pos === pos);
  if (!it) return false;
  it.locked = !it.locked;
  await store.savePlan(plan);
  return it.locked;
}

/** 讓使用者從這個角色的食譜裡挑一道；挑了就指定並鎖定。回 true 表示有改。 */
export async function assignSlotItem({ plan, slotIndex, pos, recipesById, members }) {
  const slotForRole = plan.slots[slotIndex];
  const role = slotForRole.items.find((it) => it.pos === pos)?.role ?? MEAL_ROLES[slotForRole.meal]?.[pos] ?? 'main';
  const pool = [...recipesById.values()].filter((r) => r.role === role);
  const list = h('div', { class: 'list picker-list', dataset: { list: 'assignPicker' } });
  const input = h('input', { class: 'field', type: 'search', placeholder: `找${ROLE_LABELS[role]}`, 'aria-label': '搜尋' });
  let close = null;
  const draw = () => {
    const rows = pool.filter((r) => matchesQuery(r, input.value)).slice(0, 40);
    list.replaceChildren(...rows.map((r) => {
      const cannot = members.filter((m) => versionFor(r, m.diet) === null);
      return h('button', {
        class: 'picker-item', type: 'button', dataset: { pick: r.id },
        onclick: () => close?.(r.id),
      }, r.name, h('span', { class: 'muted xs' }, ` 約 ${r.time} 分`),
      cannot.length ? h('span', { class: 'warn xs' }, ` ${cannot.map((m) => `${m.name}（${DIET_LABELS[m.diet]}）`).join('、')}吃不了`) : null);
    }));
  };
  input.addEventListener('input', draw);
  draw();
  const picked = await modal({
    title: `指定${ROLE_LABELS[role]}`, body: h('div', {}, input, list), closeX: true,
    actions: [{ label: '取消', value: null }],
    bind: (fn) => { close = fn; },
  });
  if (!picked || !recipesById.has(picked)) return false;
  assignItem(plan, slotIndex, pos, recipesById.get(picked));
  await store.savePlan(plan);
  return true;
}

/** 某一格從外食改回自己煮時把它重排（其他格不動）。 */
export async function regenerateSlot({ plan, slotIndex }) {
  const args = planArgs();
  const history = await pastHistory(plan);
  const slot = plan.slots[slotIndex];
  slot.items = [];
  const byId = new Map(args.recipes.map((r) => [r.id, r]));
  MEAL_ROLES[slot.meal].forEach((role, pos) => {
    const main = slot.items.find((x) => x.role === 'main');
    if (role === 'staple' && main && byId.get(main.recipeId)?.includesStaple) return;
    const next = swapItem({ plan, slotIndex, pos, history, ...args });
    if (next) slot.items.push(next);
  });
  slot.items.sort((a, b) => a.pos - b.pos);
}

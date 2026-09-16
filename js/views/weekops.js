// 本週頁的操作：換一道、指定、鎖定、把一格重排。跟畫面分開，好測、好讀。

import { h, modal } from '../ui.js';
import * as store from '../store.js';
import * as prefs from '../prefs.js';
import { swapItem, assignItem, daysBetween, MEAL_ROLES, MEAL_LABELS } from '../planner.js';
import { ROLE_LABELS, timeText } from '../recipeschema.js';
import { versionFor, DIET_LABELS } from '../members.js';
import { matchesQuery } from './recipes.js';

async function planArgs(plan) {
  return {
    recipes: store.allRecipes(), members: store.members(), idx: store.foodsIndex(), units: store.units(),
    rules: { noRepeatDays: prefs.get('noRepeatDays'), avoid: prefs.get('avoid'), heartyLevel: prefs.get('heartyLevel') },
    favorites: store.favoritesList(), shoppingDays: prefs.get('shoppingDays') ?? [], seed: prefs.get('planSeed') ?? 'mealmate',
    // 換一道也要考慮冰箱裡已經有什麼（跟「產生」走同一套），不然換完的那道菜會忽略「家裡有」。
    haveFoods: plan ? await store.haveFoodsForWeek(plan.weekKey) : new Set(),
  };
}

async function pastHistory(plan) {
  return (await store.history()).filter((row) => row.date < plan.monday && daysBetween(row.date, plan.monday) <= 28);
}

/** 換一道：排除現在這道，用同一套規則再挑一道。回 true 表示有換到。 */
export async function swapSlotItem({ plan, slotIndex, pos }) {
  const next = swapItem({ plan, slotIndex, pos, history: await pastHistory(plan), ...(await planArgs(plan)) });
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

/**
 * 挑一道菜的小視窗（「我來指定」與「加一道」共用）。
 * 共用的理由：兩邊都要能搜尋、都要標出「誰吃不了這道」—— 各寫一份的話，提醒遲早只剩一邊有。
 */
async function pickRecipe({ title, pool, members }) {
  const list = h('div', { class: 'list picker-list', dataset: { list: 'assignPicker' } });
  const input = h('input', { class: 'field', type: 'search', placeholder: '找菜名或食材', 'aria-label': '搜尋', dataset: { field: 'pickerSearch' } });
  let close = null;
  const draw = () => {
    const rows = pool.filter((r) => matchesQuery(r, input.value)).slice(0, 40);
    list.replaceChildren(...rows.map((r) => {
      const cannot = members.filter((m) => versionFor(r, m.diet) === null);
      return h('button', {
        class: 'picker-item', type: 'button', dataset: { pick: r.id },
        onclick: () => close?.(r.id),
      }, r.name, h('span', { class: 'muted xs' }, ` ${timeText(r.time, { short: true })}`),
      cannot.length ? h('span', { class: 'warn xs' }, ` ${cannot.map((m) => `${m.name}（${DIET_LABELS[m.diet]}）`).join('、')}吃不了`) : null);
    }));
  };
  input.addEventListener('input', draw);
  draw();
  const picked = await modal({
    title, body: h('div', {}, input, list), closeX: true,
    actions: [{ label: '取消', value: null }],
    bind: (fn) => { close = fn; },
  });
  return picked ?? null;
}

/**
 * 這一餐自己加一道（使用者 2026-09-16 要求：有時候某一餐的菜不是固定的）。
 * 位置排在固定位置之後，預設鎖定 —— 重新產生時 generateWeek 會原樣保留鎖住的菜。
 * 購物清單與每日估計都是從計畫推導的，所以加完就自己跟著變，不必另外通知誰。
 */
export async function addSlotItem({ plan, slotIndex, recipesById, members }) {
  const slot = plan.slots[slotIndex];
  const picked = await pickRecipe({ title: `${MEAL_LABELS[slot.meal]}加一道`, pool: [...recipesById.values()], members });
  if (!picked || !recipesById.has(picked)) return false;
  const recipe = recipesById.get(picked);
  const base = MEAL_ROLES[slot.meal]?.length ?? 0;
  const pos = Math.max(base - 1, ...slot.items.map((it) => it.pos)) + 1;
  slot.items = [...slot.items, { recipeId: recipe.id, role: recipe.role, pos, locked: true, added: true, reasons: ['你自己加的，已鎖定'] }]
    .sort((a, b) => a.pos - b.pos);
  await store.savePlan(plan);
  return true;
}

/** 從這一餐拿掉一道。固定位置留空（可以再「換一道」或「我來指定」補回來）。 */
export async function removeSlotItem({ plan, slotIndex, pos }) {
  const slot = plan.slots[slotIndex];
  const before = slot.items.length;
  slot.items = slot.items.filter((it) => it.pos !== pos);
  if (slot.items.length === before) return false;
  await store.savePlan(plan);   // 拿掉之後購物清單要跟著少買
  return true;
}

/** 讓使用者從這個角色的食譜裡挑一道；挑了就指定並鎖定。回 true 表示有改。 */
export async function assignSlotItem({ plan, slotIndex, pos, recipesById, members }) {
  const slotForRole = plan.slots[slotIndex];
  const role = slotForRole.items.find((it) => it.pos === pos)?.role ?? MEAL_ROLES[slotForRole.meal]?.[pos] ?? 'main';
  const pool = [...recipesById.values()].filter((r) => r.role === role);
  const picked = await pickRecipe({ title: `指定${ROLE_LABELS[role]}`, pool, members });
  if (!picked || !recipesById.has(picked)) return false;
  assignItem(plan, slotIndex, pos, recipesById.get(picked));
  await store.savePlan(plan);
  return true;
}

/** 某一格從外食改回自己煮時把它重排（其他格不動）。 */
export async function regenerateSlot({ plan, slotIndex }) {
  const args = await planArgs(plan);
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

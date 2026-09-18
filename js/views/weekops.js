// 本週頁的操作：指定、鎖定、加一道、拿掉一道、把一格重排。跟畫面分開，好測、好讀。
// 「換一道」2026-09-18 依使用者要求移除（要換就自己指定）。

import { h, modal } from '../ui.js';
import * as store from '../store.js';
import * as prefs from '../prefs.js';
import { assignItem, refillSlot, daysBetween, MEAL_ROLES, MEAL_LABELS } from '../planner.js';
import { ROLE_LABELS, timeText } from '../recipeschema.js';
import { versionFor, DIET_LABELS } from '../members.js';
import { matchesQuery } from './recipes.js';

async function planArgs(plan) {
  return {
    recipes: store.allRecipes(), members: store.members(), idx: store.foodsIndex(), units: store.units(),
    rules: { noRepeatDays: prefs.get('noRepeatDays'), avoid: prefs.get('avoid'), heartyLevel: prefs.get('heartyLevel'), riceKind: prefs.get('riceKind') },
    favorites: store.favoritesList(), shoppingDays: prefs.get('shoppingDays') ?? [], seed: prefs.get('planSeed') ?? 'mealmate',
  };
}

async function pastHistory(plan) {
  return (await store.history()).filter((row) => row.date < plan.monday && daysBetween(row.date, plan.monday) <= 28);
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
/**
 * 挑一道菜的對話框。
 * @param note   對話框頂端的一句說明（為什麼清單長這樣），沒有就不顯示。
 * @param roleHint 這一格原本的角色：清單先列同角色的，其他角色接在後面並標出角色 ——
 *   2026-09-18 使用者回報「換素菜時選不到葷食，以為搜尋壞了」：以前這裡只列同角色的菜，
 *   指定「配菜」位置時池子裡只有 56 道配菜，三杯雞、蔥爆牛肉那些主菜根本不在裡面，搜「雞」自然是空的。
 *   素食成員吃不了的照樣標出來，決定權在使用者（App 不擋）。
 */
async function pickRecipe({ title, pool, members, note = null, roleHint = null }) {
  const list = h('div', { class: 'list picker-list', dataset: { list: 'assignPicker' } });
  const input = h('input', { class: 'field', type: 'search', placeholder: '找菜名或食材', 'aria-label': '搜尋', dataset: { field: 'pickerSearch' } });
  let close = null;
  const draw = () => {
    const hits = pool.filter((r) => matchesQuery(r, input.value));
    // 同角色的排前面，其他角色接在後面（各自維持原本的順序）
    const rows = roleHint ? [...hits.filter((r) => r.role === roleHint), ...hits.filter((r) => r.role !== roleHint)] : hits;
    list.replaceChildren(...rows.slice(0, 60).map((r) => {
      const cannot = members.filter((m) => versionFor(r, m.diet) === null);
      const otherRole = roleHint && r.role !== roleHint;
      return h('button', {
        class: 'picker-item', type: 'button', dataset: { pick: r.id, role: r.role },
        onclick: () => close?.(r.id),
      }, r.name, h('span', { class: 'muted xs' }, ` ${timeText(r.time, { short: true })}`),
      otherRole ? h('span', { class: 'pill picker-role', dataset: { field: 'pickerRole' } }, ROLE_LABELS[r.role]) : null,
      cannot.length ? h('span', { class: 'warn xs' }, ` ${cannot.map((m) => `${m.name}（${DIET_LABELS[m.diet]}）`).join('、')}吃不了`) : null);
    }));
    if (!rows.length) list.replaceChildren(h('p', { class: 'muted sm' }, '沒有符合的菜。'));
  };
  input.addEventListener('input', draw);
  draw();
  const picked = await modal({
    title, closeX: true,
    body: h('div', {}, note ? h('p', { class: 'muted sm', dataset: { field: 'pickerNote' } }, note) : null, input, list),
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
  // 池子是**所有**食譜：同角色的排前面，其他角色接在後面（標出角色）。以前只列同角色的，
  // 使用者在配菜位置搜不到主菜就以為搜尋壞了（2026-09-18）。
  const pool = [...recipesById.values()];
  const vegNames = members.filter((m) => m.diet !== 'omni').map((m) => m.name);
  const note = `這一格原本是${ROLE_LABELS[role]}的位置，所以先列${ROLE_LABELS[role]}，其他種類的菜接在後面（會標出是主菜還是湯）。`
    + (vegNames.length ? `${vegNames.join('、')}吃不了的菜會標出來，要不要換還是由你決定。` : '');
  const picked = await pickRecipe({ title: `指定${ROLE_LABELS[role]}`, pool, members, note, roleHint: role });
  if (!picked || !recipesById.has(picked)) return false;
  assignItem(plan, slotIndex, pos, recipesById.get(picked));
  await store.savePlan(plan);
  return true;
}

/**
 * 某一格從外食改回自己煮時把它重排（其他格不動）。
 * 走 planner.refillSlot → fillMeal，跟「產生菜單」同一條規則 ——
 * 以前這裡是逐格呼叫 swapItem，那條路永遠補配菜、不會有混合家庭的加菜（慣例 21：同一條規則在兩個入口行為不同）。
 */
export async function regenerateSlot({ plan, slotIndex }) {
  const slot = plan.slots[slotIndex];
  slot.items = [];
  const { items } = refillSlot({ plan, slotIndex, history: await pastHistory(plan), ...(await planArgs(plan)) });
  slot.items = items;
}

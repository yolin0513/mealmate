// 本週菜單（首頁）：產生／重新產生、一天一卡、換一道、指定、鎖定、外食、為什麼選這道、每日估計。

import { h, pill, chips, toast, modal, confirmDialog, fmtNutrient } from '../ui.js';
import { setTop, render } from '../shell.js';
import { refresh } from '../router.js';
import * as store from '../store.js';
import * as prefs from '../prefs.js';
import { eduNode } from '../edu.js';
import { DIET_LABELS, familyWatchFields } from '../members.js';
import { ROLE_LABELS } from '../recipeschema.js';
import { NUTRIENT_LABELS } from '../foods.js';
import {
  generateWeek, dailyEstimates, mondayOf, weekKeyOf, weekDates, addDays, isoDate, parseDate,
  MEALS, MEAL_LABELS, MEAL_ROLES, DAY_LABELS,
} from '../planner.js';
import { swapSlotItem, assignSlotItem, toggleLock, regenerateSlot } from './weekops.js';

const KIND_LABELS = { cook: '自己煮', eatOut: '外食', skip: '不煮' };
const DEFAULT_FIELDS = ['kcal', 'protein', 'carb', 'sodium'];

function fmtMD(iso) { const d = parseDate(iso); return `${d.getMonth() + 1}/${d.getDate()}`; }

async function generate({ mondayIso, prevPlan, newSeed }) {
  const seed = newSeed ? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}` : (prevPlan?.seed ?? prefs.get('planSeed') ?? 'mealmate');
  await prefs.set('planSeed', seed);
  const { plan, diagnostics } = generateWeek({
    recipes: store.allRecipes(), members: store.members(), idx: store.foodsIndex(), units: store.units(),
    rules: { noRepeatDays: prefs.get('noRepeatDays'), avoid: prefs.get('avoid') },
    favorites: store.favoritesList(), history: await store.history(), mondayIso, seed, prevPlan, shoppingDays: prefs.get('shoppingDays') ?? [],
    haveFoods: await store.haveFoodsForWeek(weekKeyOf(mondayIso)),
  });
  await store.savePlan({ ...plan, diagnostics });
  return plan;
}

export default async function weekView(query = {}) {
  setTop({ title: '本週菜單', back: false });
  const members = store.members();
  const idx = store.foodsIndex();
  const recipesById = new Map(store.allRecipes().map((r) => [r.id, r]));
  const offset = query.w === 'next' ? 1 : 0;
  const mondayIso = addDays(mondayOf(isoDate(new Date())), 7 * offset);
  const weekKey = weekKeyOf(mondayIso);
  const dates = weekDates(mondayIso);
  const plan = await store.getPlan(weekKey);
  const wants = store.wantThisWeekIds();
  const shoppingDays = prefs.get('shoppingDays') ?? [];

  const weekChips = chips({
    options: [{ value: 'this', label: '本週' }, { value: 'next', label: '下週' }], value: offset ? 'next' : 'this', name: 'week',
    onChange: (v) => { location.hash = v === 'next' ? '#/?w=next' : '#/'; },
  });
  const rangeLabel = `${fmtMD(dates[0])}（一）– ${fmtMD(dates[6])}（日）`;

  // ---------- 還沒有計畫 ----------
  if (!plan) {
    const genBtn = h('button', { class: 'btn btn-primary', type: 'button', dataset: { action: 'generate' } }, offset ? '產生下週菜單' : '產生本週菜單');
    genBtn.addEventListener('click', async () => {
      if (genBtn.disabled) return;
      genBtn.disabled = true; genBtn.textContent = '排菜中…';
      try { await generate({ mondayIso, prevPlan: null, newSeed: true }); refresh(); }
      catch (e) { genBtn.disabled = false; genBtn.textContent = '再試一次'; toast(`排不出來：${String(e.message || e)}`, 4000); }
    });
    const hero = h('section', { class: 'card hero', dataset: { card: 'weekEmpty' } },
      h('div', { class: 'row-actions' }, weekChips, h('span', { class: 'muted sm' }, rangeLabel)),
      h('h2', {}, offset ? '下週吃什麼，交給 MealMate 排' : '這一週吃什麼，交給 MealMate 排'),
      h('p', {}, '一鍵產生一週菜單：主菜 14 天內不重複、素葷可以一鍋兩吃、每道菜都會告訴你為什麼選它。'),
      h('ol', { class: 'steps' },
        h('li', {}, h('span', { class: 'step-no' }, members.length ? '✓' : '1'),
          h('div', {}, h('p', { class: 'row-title' }, '家人'), h('p', { class: 'muted sm' }, members.length ? members.map((m) => `${m.name}（${DIET_LABELS[m.diet]}）`).join('、') : '還沒新增；沒有家人也能排，會當成都吃葷、沒有要留意的項目'))),
        h('li', {}, h('span', { class: 'step-no' }, shoppingDays.length ? '✓' : '2'),
          h('div', {}, h('p', { class: 'row-title' }, '買菜日'), h('p', { class: 'muted sm' }, shoppingDays.length ? `星期${[...shoppingDays].sort().map((d) => '日一二三四五六'[d]).join('、')}` : '還沒選；沒選的話不會考慮食材放幾天'))),
        h('li', {}, h('span', { class: 'step-no' }, '3'),
          h('div', {}, h('p', { class: 'row-title' }, '產生菜單'), h('p', { class: 'muted sm' }, wants.length ? `你勾了 ${wants.length} 道「本週想吃」，會優先排進來` : '收藏頁勾「本週想吃」的菜會優先排進來'))),
      ),
      h('div', { class: 'btn-row' }, genBtn, h('a', { class: 'btn', href: '#/family' }, '設定家人與買菜日')),
    );
    render(hero, noticeFooter());
    return;
  }

  // ---------- 有計畫 ----------
  const regenBtn = h('button', { class: 'btn', type: 'button', dataset: { action: 'regenerate' } }, '重新產生（鎖住的不動）');
  regenBtn.addEventListener('click', async () => {
    if (regenBtn.disabled) return;
    regenBtn.disabled = true;
    try { await generate({ mondayIso, prevPlan: plan, newSeed: true }); toast('已重新排好'); refresh(); }
    catch (e) { regenBtn.disabled = false; toast(`排不出來：${String(e.message || e)}`, 4000); }
  });
  const head = h('section', { class: 'card', dataset: { card: 'weekHead' } },
    h('div', { class: 'row-actions' }, weekChips, h('span', { class: 'muted sm' }, rangeLabel)),
    h('div', { class: 'btn-row' }, regenBtn),
  );

  const diag = plan.diagnostics ?? { forcedRepeats: [], relaxed: [], empty: [], poolSizes: {} };
  const diagCard = (diag.forcedRepeats.length || diag.relaxed.length || diag.empty.length)
    ? h('section', { class: 'card notice', dataset: { card: 'diagnostics' } },
      h('strong', {}, '這週有幾個地方是勉強排的'),
      diag.forcedRepeats.length ? h('p', {}, `${diag.forcedRepeats.length} 道在不重複天數內重複了（${summarizeRoles(diag.forcedRepeats)}），因為符合條件的菜不夠。可以到食譜頁新增或收藏更多菜。`) : null,
      diag.relaxed.length ? h('p', {}, `${diag.relaxed.length} 道放寬了時間上限或同餐烹法的限制。`) : null,
      diag.empty.length ? h('p', {}, `${diag.empty.length} 個位置排不出菜（${summarizeRoles(diag.empty)}），可以手動指定。`) : null,
    ) : null;

  const watch = familyWatchFields(members);
  const fields = watch.length ? watch : DEFAULT_FIELDS;
  const units = idx?.units ?? {};

  const dayCards = dates.map((date, day) => {
    const daySlots = plan.slots.filter((s) => s.day === day);
    const isShop = shoppingDays.includes(parseDate(date).getDay());
    const mealBlocks = MEALS.map((meal) => {
      const slot = daySlots.find((s) => s.meal === meal);
      const slotIndex = plan.slots.indexOf(slot);
      return mealBlock({ slot, slotIndex, plan, mondayIso, recipesById, members });
    });
    return h('section', { class: 'card day-card', dataset: { card: 'day', day: String(day) } },
      h('h2', { class: 'card-title' }, `週${DAY_LABELS[day]} ${fmtMD(date)}`, isShop ? ' ' : '', isShop ? pill('買菜日', 'green') : null),
      ...mealBlocks,
      estimateBlock({ daySlots, members, idx, recipesById, fields, units }),
    );
  });

  render(head, diagCard, h('div', { class: 'week-grid' }, ...dayCards), noticeFooter());
}

function summarizeRoles(list) {
  const counts = {};
  for (const x of list) counts[x.role] = (counts[x.role] ?? 0) + 1;
  return Object.entries(counts).map(([r, n]) => `${ROLE_LABELS[r] ?? r} ${n}`).join('、');
}

function noticeFooter() {
  return h('section', { class: 'card', dataset: { card: 'weekFooter' } },
    h('p', { class: 'muted sm' }, '營養數字都是估計值、前面有「估」字；慢性病留意設定只影響哪些數字顯示與排菜順序，不是醫囑。'),
    h('details', { class: 'how' }, h('summary', {}, '一般衛教參考'),
      h('p', { class: 'muted sm' }, '國健署「國人膳食營養素參考攝取量」是以健康人為對象的一般參考，App 不拿它替任何人設目標。若醫師或營養師有給你每日目標，可在家人設定裡填，這裡只做加總對照。'),
      eduNode('hpa.dris.scope')),
  );
}

// ---------- 一餐 ----------
function mealBlock({ slot, slotIndex, plan, mondayIso, recipesById, members }) {
  const kindBtn = h('button', { class: 'chip chip-sm' + (slot.kind !== 'cook' ? ' on' : ''), type: 'button', dataset: { action: 'kind', slot: String(slotIndex) }, 'aria-label': `${MEAL_LABELS[slot.meal]}：${KIND_LABELS[slot.kind]}` }, KIND_LABELS[slot.kind]);
  kindBtn.addEventListener('click', async () => {
    const next = await modal({
      title: `${MEAL_LABELS[slot.meal]}怎麼安排`,
      body: h('p', { class: 'muted sm' }, '外食或不煮的那一餐不排菜、不進購物清單。'),
      actions: [{ label: '自己煮', value: 'cook', primary: slot.kind !== 'cook' }, { label: '外食', value: 'eatOut' }, { label: '不煮', value: 'skip' }, { label: '取消', value: null }],
    });
    if (!next || next === slot.kind) return;
    plan.slots[slotIndex] = { ...slot, kind: next, items: next === 'cook' ? slot.items : [] };
    if (next === 'cook' && slot.items.length === 0) {
      // 改回自己煮：把這一格重新排（其他格不動）
      await regenerateSlot({ plan, slotIndex });
    }
    await store.savePlan(plan);
    refresh();
  });

  const items = slot.kind === 'cook'
    ? h('div', { class: 'meal-items' }, ...MEAL_ROLES[slot.meal].map((role) => {
      const it = slot.items.find((x) => x.role === role);
      if (!it) {
        const main = slot.items.find((x) => x.role === 'main');
        if (role === 'staple' && main && recipesById.get(main.recipeId)?.includesStaple) return null;
        return h('div', { class: 'meal-item empty', dataset: { slot: String(slotIndex), role } }, pill(ROLE_LABELS[role]), h('span', { class: 'muted sm' }, '排不出菜'), itemMenuBtn({ slot, slotIndex, role, item: null, plan, mondayIso, recipesById, members }));
      }
      const r = recipesById.get(it.recipeId);
      return h('div', { class: 'meal-item', dataset: { slot: String(slotIndex), role, item: it.recipeId } },
        pill(ROLE_LABELS[role]),
        h('a', { class: 'meal-name', href: `#/recipes/${it.recipeId}` }, r?.name ?? it.recipeId),
        it.locked ? h('span', { class: 'lock', title: '已鎖定', 'aria-label': '已鎖定' }, '🔒') : null,
        itemMenuBtn({ slot, slotIndex, role, item: it, plan, mondayIso, recipesById, members }),
      );
    }))
    : h('p', { class: 'muted sm' }, slot.kind === 'eatOut' ? '這一餐外食，不排菜。' : '這一餐不煮。');

  return h('div', { class: 'meal-block', dataset: { slot: String(slotIndex), meal: slot.meal, kind: slot.kind } },
    h('div', { class: 'meal-head' }, h('strong', {}, MEAL_LABELS[slot.meal]), kindBtn),
    items,
  );
}

function itemMenuBtn({ slot, slotIndex, role, item, plan, mondayIso, recipesById, members }) {
  const btn = h('button', { class: 'icon-btn item-menu', type: 'button', 'aria-label': `${MEAL_LABELS[slot.meal]}${ROLE_LABELS[role]}的選項`, dataset: { action: 'itemMenu', slot: String(slotIndex), role } }, '⋯');
  btn.addEventListener('click', async () => {
    const r = item ? recipesById.get(item.recipeId) : null;
    const reasons = item?.reasons ?? [];
    const body = h('div', {},
      r ? h('p', { class: 'row-title' }, r.name) : h('p', { class: 'muted' }, '這個位置目前沒有菜'),
      reasons.length ? h('div', { class: 'reasons', dataset: { field: 'reasons' } }, h('p', { class: 'muted xs' }, '為什麼選這道'), h('ul', { class: 'reason-list' }, ...reasons.map((t) => h('li', {}, t)))) : null,
    );
    const choice = await modal({
      title: `${MEAL_LABELS[slot.meal]} · ${ROLE_LABELS[role]}`, body, closeX: true,
      actions: [
        ...(item ? [{ label: item.locked ? '解除鎖定' : '鎖定這道', value: 'lock' }] : []),
        { label: '換一道', value: 'swap' },
        { label: '我來指定…', value: 'assign' },
        ...(r ? [{ label: '看食譜', value: 'open' }] : []),
      ],
    });
    if (!choice) return;
    if (choice === 'open') { location.hash = `#/recipes/${item.recipeId}`; return; }
    if (choice === 'lock') { await toggleLock({ plan, slotIndex, role }); refresh(); return; }
    if (choice === 'swap') { const ok = await swapSlotItem({ plan, slotIndex, role }); toast(ok ? '換好了' : '沒有別的菜可以換了', 2600); refresh(); return; }
    if (choice === 'assign') { const done = await assignSlotItem({ plan, slotIndex, role, recipesById, members }); if (done) { toast('已指定並鎖定'); refresh(); } }
  });
  return btn;
}

// ---------- 每日估計 ----------
function estimateBlock({ daySlots, members, idx, recipesById, fields, units }) {
  if (!idx) return null;
  const rows = dailyEstimates(daySlots, members, idx, recipesById, fields);
  const anyCook = daySlots.some((s) => s.kind === 'cook' && s.items.length);
  if (!anyCook) return null;
  return h('details', { class: 'how day-estimate', dataset: { field: 'dayEstimate' } },
    h('summary', {}, '今日估算（每人一份，三餐加總）'),
    ...rows.map((row) => {
      const member = members.find((m) => m.name === row.label);
      const targets = member?.targets ?? {};
      return h('div', { class: 'est-row', dataset: { member: row.label } },
        h('p', { class: 'row-title' }, row.label, member ? h('span', { class: 'muted xs' }, `（${DIET_LABELS[member.diet]}）`) : null),
        h('div', { class: 'nutri-grid' }, ...fields.map((f) => h('div', { class: 'nutri-row' }, h('span', {}, NUTRIENT_LABELS[f]), h('span', { class: 'num nutri-value', dataset: { nutrient: f } }, fmtNutrient(row.fields[f], units[f]))))),
        ...fields.filter((f) => targets[f] != null && row.fields[f] != null).map((f) => h('p', { class: 'sm target-line', dataset: { target: f } },
          `${NUTRIENT_LABELS[f]}：醫師或營養師給的每日目標 ${targets[f]} ${units[f] ?? ''}，今日估 ${fmtNutrient(row.fields[f], units[f]).replace('估 ', '')}（${Math.round(row.fields[f] / targets[f] * 100)}%）`)),
        row.missing ? h('p', { class: 'muted xs' }, `有 ${row.missing} 道這位吃不了，沒算進去`) : null,
      );
    }),
    h('p', { class: 'muted xs' }, '早餐、午餐、晚餐每人一份的估計值加總；沒有算進外食與零食。數字前的「估」代表依食藥署資料庫估算。'),
  );
}

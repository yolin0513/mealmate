// 本週菜單（首頁）：產生／重新產生、一天一卡、指定、鎖定、外食、為什麼選這道、每日估計。
// 「換一道」2026-09-18 依使用者要求移除（要換就自己指定）。

import { h, pill, chips, toast, modal, confirmDialog, fmtNutrient } from '../ui.js';
import { setTop, render } from '../shell.js';
import { refresh } from '../router.js';
import * as store from '../store.js';
import * as prefs from '../prefs.js';
import { eduNode } from '../edu.js';
import { DIET_LABELS, displayFields, familyWatchFields } from '../members.js';
import { ROLE_LABELS, METHOD_LABELS } from '../recipeschema.js';
import { NUTRIENT_LABELS } from '../foods.js';
import {
  generateWeek, dailyEstimates, mondayOf, weekKeyOf, weekDates, addDays, isoDate, parseDate,
  MEALS, MEAL_LABELS, MEAL_ROLES, DAY_LABELS, RELAXABLE, weekBalance, balanceSentence, groupEstimates, plainReasons,
} from '../planner.js';
import { versionFor } from '../members.js';
import { assignSlotItem, addSlotItem, removeSlotItem, toggleLock, regenerateSlot } from './weekops.js';

const KIND_LABELS = { cook: '自己煮', eatOut: '外食', skip: '不煮' };

function fmtMD(iso) { const d = parseDate(iso); return `${d.getMonth() + 1}/${d.getDate()}`; }

async function generate({ mondayIso, prevPlan, newSeed }) {
  const seed = newSeed ? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}` : (prevPlan?.seed ?? prefs.get('planSeed') ?? 'mealmate');
  await prefs.set('planSeed', seed);
  const { plan, diagnostics } = generateWeek({
    recipes: store.allRecipes(), members: store.members(), idx: store.foodsIndex(), units: store.units(),
    rules: { noRepeatDays: prefs.get('noRepeatDays'), avoid: prefs.get('avoid'), heartyLevel: prefs.get('heartyLevel'), riceKind: prefs.get('riceKind') },
    favorites: store.favoritesList(), history: await store.history(), mondayIso, seed, prevPlan, shoppingDays: prefs.get('shoppingDays') ?? [],
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
  // 今天之前的日子**不列出來**（2026-09-18 Yolin：已過的直接不要列）。v0.28.0 先做的是「收起來、標已過」，
  // 再問一次之後定案拿掉：那幾天的菜早就煮完，留著只是往下滑的距離。排菜的「幾天內不重複」看的是存著的計畫，不受影響。
  // 其餘每一天收不收：手動設過的照手動，沒設過的展開。
  const todayIso = isoDate(new Date());
  const folds = prefs.dayFoldsFor(weekKey);
  const isPastDay = (date) => date < todayIso;
  const dayIsOpen = (day) => (folds[day] ? folds[day] === 'open' : true);

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
  const printBtn = h('button', { class: 'btn', type: 'button', dataset: { action: 'printWeek' } }, '印出');
  printBtn.addEventListener('click', () => window.print());
  const head = h('section', { class: 'card', dataset: { card: 'weekHead' } },
    h('div', { class: 'row-actions' }, weekChips, h('span', { class: 'muted sm' }, rangeLabel)),
    h('div', { class: 'btn-row no-print' }, regenBtn, printBtn),
  );

  const diag = plan.diagnostics ?? { forcedRepeats: [], relaxed: [], empty: [], poolSizes: {} };
  const diagCard = (diag.forcedRepeats.length || diag.relaxed.length || diag.empty.length)
    ? h('section', { class: 'card notice', dataset: { card: 'diagnostics' } },
      h('strong', {}, '這週有幾個地方是勉強排的'),
      diag.forcedRepeats.length ? h('p', {}, `${diag.forcedRepeats.length} 道在不重複天數內重複了（${summarizeRoles(diag.forcedRepeats)}），因為符合條件的菜不夠。可以到食譜頁新增或收藏更多菜。`) : null,
      diag.relaxed.length ? h('p', { dataset: { field: 'relaxed' } }, `${diag.relaxed.length} 道放寬了限制：${summarizeRelaxed(diag.relaxed)}。`) : null,
      shelfHint(diag.relaxed, shoppingDays),
      diag.empty.length ? h('p', {}, `${diag.empty.length} 個位置排不出菜（${summarizeRoles(diag.empty)}），可以手動指定。`) : null,
      (diag.noMeat ?? []).length ? h('p', { dataset: { field: 'noMeat' } }, `${diag.noMeat.length} 餐沒有排到葷菜（${diag.noMeat[0].why}）。要吃葷的話可以在那一格手動指定。`) : null,
    ) : null;

  // 勾了「本週想吃」卻沒排進去：一定要講，而且講實際原因（2026-09-14 使用者回報：重新產生幾次都沒排到，畫面上也沒說為什麼）。
  // 只列現在還勾著、而且現在的菜單裡真的沒有的（換一道、指定之後排進去了就不再講）。
  const inPlan = new Set(plan.slots.flatMap((s) => (s.items ?? []).map((it) => it.recipeId)));
  const missedWants = (diag.wantMissed ?? []).filter((x) => wants.includes(x.recipeId) && !inPlan.has(x.recipeId) && recipesById.has(x.recipeId));
  const wantCard = missedWants.length ? h('section', { class: 'card notice', dataset: { card: 'wantMissed' } },
    h('strong', {}, '你勾的「本週想吃」有沒排進去的'),
    ...missedWants.map((x) => h('p', { dataset: { field: 'wantMissedLine' } }, `你想吃的「${recipesById.get(x.recipeId).name}」這週沒排進去，因為${x.why}。`)),
  ) : null;

  // 一週平衡：這週排了幾道比較豐盛的主菜、有沒有超過設定。從**現在的菜單**重算（換過、鎖過的都算進去），
  // 讓使用者看得到排菜器做了什麼，不是偷偷調。
  const balance = weekBalance({ plan, recipes: store.allRecipes(), members, idx, units: store.units(), rules: { heartyLevel: prefs.get('heartyLevel') } });
  const balanceCard = h('section', { class: 'card', dataset: { card: 'balance' } },
    h('strong', {}, '一週平衡'),
    h('p', { class: 'muted sm', dataset: { field: 'balanceText' } }, balanceSentence(balance)),
  );

  // 預設只顯示熱量與蛋白質；有設留意項目的家人，那幾項一定加顯（displayFields）
  const fields = displayFields(members);
  const watch = familyWatchFields(members);
  const units = idx?.units ?? {};

  const shownDays = dates.map((date, day) => ({ date, day })).filter(({ date }) => !isPastDay(date));
  const hiddenPast = dates.length - shownDays.length;
  const dayCards = shownDays.map(({ date, day }) => {
    const daySlots = plan.slots.filter((s) => s.day === day);
    const isShop = shoppingDays.includes(parseDate(date).getDay());
    const mealBlocks = MEALS.map((meal) => {
      const slot = daySlots.find((s) => s.meal === meal);
      const slotIndex = plan.slots.indexOf(slot);
      return mealBlock({ slot, slotIndex, plan, mondayIso, recipesById, members });
    });
    const anyCook = daySlots.some((s) => s.kind === 'cook' && s.items.length);
    const isOpen = dayIsOpen(day);
    const isToday = date === todayIso;
    // 收起來的內容用 hidden：它會真的從版面消失（CSS 有 [hidden]{display:none!important}），
    // 螢幕閱讀器也讀不到。只把高度壓成 0 或改個顏色的話，讀螢幕的人還是會念到整天的菜。
    const body = h('div', { class: 'day-body', dataset: { field: 'dayBody', day: String(day) } },
      ...mealBlocks,
      estimateBlock({ daySlots, members, idx, recipesById, fields, units }),
    );
    body.hidden = !isOpen;
    const caret = h('span', { class: 'day-caret', 'aria-hidden': 'true' }, isOpen ? '▾' : '▸');
    // 收起來時標題旁邊留一行摘要，不然桌機七欄會變成七個看不出差別的日期。
    const summary = h('span', { class: 'muted xs day-summary', dataset: { field: 'daySummary' } }, daySummaryText(daySlots));
    summary.hidden = isOpen;
    const toggle = h('button', {
      class: 'day-toggle', type: 'button', 'aria-expanded': isOpen ? 'true' : 'false',
      'aria-controls': `dayBody-${day}`, dataset: { action: 'toggleDay', day: String(day) },
    }, caret, h('span', { class: 'card-title' }, `週${DAY_LABELS[day]} ${fmtMD(date)}`),
    isToday ? pill('今天', 'accent') : null,
    isShop ? pill('買菜日', 'green') : null, summary);
    body.id = `dayBody-${day}`;
    const card = h('section', { class: 'card day-card' + (isOpen ? '' : ' collapsed'), dataset: { card: 'day', day: String(day), open: isOpen ? 'true' : 'false', today: isToday ? 'true' : 'false' } },
      h('div', { class: 'day-head' }, toggle,
        anyCook ? h('a', { class: 'btn btn-sm no-print', href: `#/today?d=${date}`, dataset: { action: 'cookToday', day: String(day) } }, '一起煮 ›') : null),
      body,
    );
    toggle.addEventListener('click', async () => {
      const open = toggle.getAttribute('aria-expanded') !== 'true';
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      body.hidden = !open;
      summary.hidden = open;
      caret.textContent = open ? '▾' : '▸';
      card.classList.toggle('collapsed', !open);
      card.dataset.open = open ? 'true' : 'false';
      await prefs.setCollapsedDay(weekKey, day, !open);
    });
    return card;
  });

  const pastNote = hiddenPast ? h('p', { class: 'muted xs', dataset: { field: 'pastNote' } }, `這週已過的 ${hiddenPast} 天不列出來。`) : null;
  // 桌機的欄數跟著實際列出的天數走（週五打開只剩三欄，不要留四欄空白）
  const grid = h('div', { class: 'week-grid', style: `--days:${Math.max(1, dayCards.length)}` }, ...dayCards);
  render(head, wantCard, diagCard, balanceCard, pastNote, grid, noticeFooter());
}

const RELAX_LABELS = {
  relaxBreakfast: '早餐跟前一天一樣',
  relaxShelf: '食材放不到那一天',
  relaxTime: '超過這一餐的時間上限',
  relaxMethod: '同一餐有兩道同樣烹法',
  relaxDay: '同一天重複同一道',
};

/**
 * 診斷卡要講**實際**被放寬的那幾條，而且一道菜算一道。
 * 舊版拿 diagnostics.relaxed.length 當道數（那時候一道菜每開一個旗標推一筆，12 道會講成 37 道），
 * 文案又寫死「時間上限或同餐烹法」—— 真正的主因（保存期限）從來沒被講出來過，
 * 使用者照那句去加菜是加錯方向。
 */
function summarizeRelaxed(list) {
  const counts = {};
  for (const r of list) for (const c of r.constraints ?? []) counts[c] = (counts[c] ?? 0) + 1;
  return RELAXABLE.filter((k) => counts[k]).map((k) => `${counts[k]} 道${RELAX_LABELS[k]}`).join('、');
}

/**
 * 保存期限造成的放寬，最有效的解法是多一個買菜日（實測：同一組家人只買週三時 6 道被放寬，
 * 加上週六變 0 道）。把這件事跟使用者自己的買菜日設定連起來，不然他看到「食材放不到那一天」
 * 也不知道該做什麼。買菜日一天都沒設的話保存期限根本不會生效，所以只有「剛好一天」要提示。
 */
function shelfHint(list, shoppingDays) {
  const n = list.filter((r) => (r.constraints ?? []).includes('relaxShelf')).length;
  if (!n || shoppingDays.length !== 1) return null;
  const day = '日一二三四五六'[shoppingDays[0]];
  return h('p', { dataset: { field: 'shelfHint' } },
    `其中 ${n} 道是食材放不到那一天：你一週只買一次菜（星期${day}），離買菜日最遠有 6 天。`,
    h('a', { href: '#/family' }, '到「家人」分頁多勾一個買菜日'),
    '，這幾道就排得開了。');
}

/** 收起來時顯示的一行摘要：講得出「這天有沒有事」就夠了。 */
function daySummaryText(daySlots) {
  const cook = daySlots.filter((s) => s.kind === 'cook' && s.items.length);
  const dishes = cook.reduce((n, s) => n + s.items.length, 0);
  const out = daySlots.filter((s) => s.kind === 'eatOut').length;
  const skip = daySlots.filter((s) => s.kind === 'skip').length;
  const parts = [];
  if (cook.length) parts.push(`${cook.length} 餐自己煮、${dishes} 道`);
  if (out) parts.push(`${out} 餐外食`);
  if (skip) parts.push(`${skip} 餐不煮`);
  return parts.length ? parts.join('，') : '還沒排';
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
      body: null,
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

  // 一道菜畫成一列。固定位置與「自己加的」共用這一支，不然兩邊的樣子會慢慢漂開。
  const itemRow = (it, pos) => {
    const r = recipesById.get(it.recipeId);
    return h('div', { class: 'meal-item', dataset: { slot: String(slotIndex), role: it.role, pos: String(pos), item: it.recipeId, ...(it.extraMeat ? { extra: 'meat' } : {}), ...(it.added ? { added: 'true' } : {}) } },
      pill(it.extraMeat ? '加菜' : ROLE_LABELS[it.role]),
      h('a', { class: 'meal-name', href: `#/recipes/${it.recipeId}` }, r?.name ?? it.recipeId),
      // 標籤全部收在同一個格子裡。以前它們各佔一欄，而 .meal-item 只有四欄 ——
      // 「自己加的」＋🔒 或「僅葷食成員」＋🔒 就變成第五個子元素，「⋯」被擠到下一行（使用者回報）。
      // 現在不管掛幾個標籤，「⋯」永遠是最後一欄。
      h('div', { class: 'meal-badges', dataset: { field: 'itemBadges' } },
        it.extraMeat ? pill('僅葷食成員', 'accent') : null,
        it.added ? pill('自己加的') : null,
        it.locked ? h('span', { class: 'lock', title: '已鎖定', 'aria-label': '已鎖定' }, '🔒') : null),
      itemMenuBtn({ slot, slotIndex, pos, role: it.role, item: it, plan, mondayIso, recipesById, members }),
    );
  };
  const fixedCount = MEAL_ROLES[slot.meal].length;
  const items = slot.kind === 'cook'
    // 一餐有兩道配菜，所以每道菜認的是**位置**不是角色（只看角色的話兩道配菜分不開）
    ? h('div', { class: 'meal-items' }, ...MEAL_ROLES[slot.meal].map((slotRole, pos) => {
      const it = slot.items.find((x) => x.pos === pos);
      if (!it) {
        const main = slot.items.find((x) => x.role === 'main');
        if (slotRole === 'staple' && main && recipesById.get(main.recipeId)?.includesStaple) return null;
        return h('div', { class: 'meal-item empty', dataset: { slot: String(slotIndex), role: slotRole, pos: String(pos) } }, pill(ROLE_LABELS[slotRole]), h('span', { class: 'muted sm' }, '這格沒有菜'), itemMenuBtn({ slot, slotIndex, pos, role: slotRole, item: null, plan, mondayIso, recipesById, members }));
      }
      return itemRow(it, pos);
    }),
    // 自己加的菜排在固定位置之後
    ...slot.items.filter((it) => it.pos >= fixedCount).sort((a, b) => a.pos - b.pos).map((it) => itemRow(it, it.pos)))
    : h('p', { class: 'muted sm' }, slot.kind === 'eatOut' ? '這一餐外食，不排菜。' : '這一餐不煮。');

  // 自己加一道：有時候某一餐的菜就不是固定的（使用者 2026-09-16 要求）
  const addBtn = slot.kind === 'cook'
    ? h('button', { class: 'chip chip-sm', type: 'button', dataset: { action: 'addDish', slot: String(slotIndex) }, 'aria-label': `${MEAL_LABELS[slot.meal]}加一道菜` }, '＋ 加一道')
    : null;
  if (addBtn) addBtn.addEventListener('click', async () => {
    const done = await addSlotItem({ plan, slotIndex, recipesById, members });
    if (done) { toast('已加進這一餐'); refresh(); }
  });
  return h('div', { class: 'meal-block', dataset: { slot: String(slotIndex), meal: slot.meal, kind: slot.kind } },
    h('div', { class: 'meal-head' }, h('strong', {}, MEAL_LABELS[slot.meal]), kindBtn, addBtn),
    items,
  );
}

function itemMenuBtn({ slot, slotIndex, pos, role, item, plan, mondayIso, recipesById, members }) {
  const btn = h('button', { class: 'icon-btn item-menu', type: 'button', 'aria-label': `${MEAL_LABELS[slot.meal]}${ROLE_LABELS[role]}的選項`, dataset: { action: 'itemMenu', slot: String(slotIndex), role, pos: String(pos) } }, '⋯');
  btn.addEventListener('click', async () => {
    const r = item ? recipesById.get(item.recipeId) : null;
    // 2026-09-18 使用者回報：這張卡在別支手機上跑版，而且「估 鈉…中位數…」那一長串一般人看不懂。
    // 重做成：菜名（同一行右邊「看食譜」）→ 一行簡單資訊（時間、烹法、當季、誰吃得了）→
    // 其餘理由收進預設收起的「為什麼選這道」；**帶估算數字的理由一句都不印**（plainReasons）。
    // 營養數字要看就進食譜頁；留意欄位照樣影響排序，只是不印在這裡。
    const month = new Date().getMonth() + 1;
    const meta = [];
    if (r) {
      meta.push(`約 ${r.time} 分鐘`);
      if (METHOD_LABELS[r.method]) meta.push(METHOD_LABELS[r.method]);
      if (r.season?.length && r.season.includes(month)) meta.push(`當季（${month} 月）`);
      for (const m of members) {
        const v = versionFor(r, m.diet);
        if (m.diet === 'omni') continue;
        meta.push(v ? `${m.name}（${DIET_LABELS[m.diet]}）可吃${v === 'veg' ? '素版' : ''}` : `${m.name}（${DIET_LABELS[m.diet]}）吃不了`);
      }
    }
    const others = plainReasons(item?.reasons).filter((t) => !/^約 \d+ 分鐘/.test(t) && !/可吃/.test(t));
    const body = h('div', { class: 'menu-body' },
      r
        ? h('div', { class: 'menu-head' },
          h('p', { class: 'row-title menu-name' }, r.name),
          h('a', { class: 'btn btn-sm menu-open', href: `#/recipes/${r.id}`, dataset: { action: 'openRecipe' } }, '看食譜 ›'))
        : h('p', { class: 'muted' }, '這個位置目前沒有菜'),
      meta.length ? h('p', { class: 'muted sm menu-meta', dataset: { field: 'menuMeta' } }, meta.join(' · ')) : null,
      item?.extraMeat ? h('p', { class: 'muted sm' }, '這道是給吃葷的人的加菜，素食成員吃不了；同一餐其他幾道他們吃得到。') : null,
      others.length ? h('details', { class: 'reasons', dataset: { field: 'reasons' } },
        h('summary', { class: 'muted xs' }, '為什麼選這道'),
        h('ul', { class: 'reason-list' }, ...others.map((t) => h('li', {}, t)))) : null,
    );
    const choice = await modal({
      title: `${MEAL_LABELS[slot.meal]} · ${ROLE_LABELS[role]}`, body, closeX: true, actionsClass: 'modal-actions-grid',
      // 2026-09-18 Yolin：上排「鎖定／解除鎖定｜拿掉這道」並排，下排「我來指定…」單獨一排、滿寬（左右對稱）
      actions: [
        ...(item ? [{ label: item.locked ? '解除鎖定' : '鎖定這道', value: 'lock' }, { label: '拿掉這道', value: 'remove', danger: true }] : []),
        { label: '我來指定…', value: 'assign', wide: true },
      ],
    });
    if (!choice) return;
    if (choice === 'lock') { await toggleLock({ plan, slotIndex, pos }); refresh(); return; }
    if (choice === 'remove') { const gone = await removeSlotItem({ plan, slotIndex, pos }); toast(gone ? '已拿掉這道' : '這格本來就沒有菜'); refresh(); return; }
    if (choice === 'assign') { const done = await assignSlotItem({ plan, slotIndex, pos, recipesById, members }); if (done) { toast('已指定並鎖定'); refresh(); } }
  });
  return btn;
}

// ---------- 每日估計 ----------
function estimateBlock({ daySlots, members, idx, recipesById, fields, units }) {
  if (!idx) return null;
  const watch = familyWatchFields(members);
  const rows = dailyEstimates(daySlots, members, idx, recipesById, fields);
  const anyCook = daySlots.some((s) => s.kind === 'cook' && s.items.length);
  if (!anyCook) return null;
  return h('details', { class: 'how day-estimate', dataset: { field: 'dayEstimate' } },
    h('summary', {}, '今日估算（每人一份，三餐加總）'),
    // 數字一樣的成員併成一組：吃葷的三個人本來就吃到同一份估算，列三次只是重複（使用者 2026-09-16 回報）
    ...groupEstimates(rows, fields).map((g) => {
      const groupMembers = g.labels.map((name) => members.find((m) => m.name === name)).filter(Boolean);
      const dietText = groupMembers.length ? g.diets.map((d) => DIET_LABELS[d]).join('、') : g.labels[0];
      return h('div', { class: 'est-row est-card', dataset: { members: g.labels.join('、'), diets: g.diets.join(',') } },
        h('div', { class: 'est-head' },
          h('span', { class: 'est-diet' }, dietText),
          groupMembers.length ? h('span', { class: 'est-names' }, g.labels.join('、')) : null),
        h('div', { class: 'est-values' }, ...fields.map((f) => h('div', { class: 'est-line' },
          h('span', { class: 'est-key' }, NUTRIENT_LABELS[f]),
          h('span', { class: 'num nutri-value', dataset: { nutrient: f } }, fmtNutrient(g.fields[f], units[f]))))),
        // 每日目標是**個人**的，所以逐位列（標明是誰的），不會因為併組而混在一起
        ...groupMembers.flatMap((m) => fields
          .filter((f) => m.targets?.[f] != null && g.fields[f] != null)
          .map((f) => h('p', { class: 'sm target-line', dataset: { target: f, member: m.name } },
            `${m.name}：${NUTRIENT_LABELS[f]} 醫師或營養師給的每日目標 ${m.targets[f]} ${units[f] ?? ''}，今日估 ${fmtNutrient(g.fields[f], units[f]).replace('估 ', '')}（${Math.round(g.fields[f] / m.targets[f] * 100)}%）`))),
        g.missing ? h('p', { class: 'muted xs' }, `有 ${g.missing} 道這一組吃不了，沒算進去`) : null,
        g.partialDishes ? h('p', { class: 'muted xs', dataset: { field: 'partialDishes' } }, `其中 ${g.partialDishes} 道有食材查不到營養資料，這天的數字只是部分估算`) : null,
      );
    }),
    h('p', { class: 'muted xs' }, watch.length
      ? `早餐、午餐、晚餐每人一份的估計值加總；沒有算進外食與零食。熱量與蛋白質之後那幾項（${watch.map((k) => NUTRIENT_LABELS[k]).join('、')}）是家人設定的留意項目。`
      : '早餐、午餐、晚餐每人一份的估計值加總；沒有算進外食與零食。數字前的「估」代表依食藥署資料庫估算。'),
  );
}

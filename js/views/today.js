// 今日一起煮：當餐所有菜的步驟合併成一條時間線，每一步有大按鈕「完成」。
//
// **營養永遠是素版一欄、葷版一欄，各自估算、不相加。** 時間線合併的是步驟，不是營養
// （PLAN §3.3、§5A；timelinetest 與 todaytest 各有斷言與突變盯著）。

import { h, pill, chips, fmtNutrient, toast, confirmDialog } from '../ui.js';
import { setTop, render } from '../shell.js';
import { refresh } from '../router.js';
import * as store from '../store.js';
import { eduNode } from '../edu.js';
import { DIET_LABELS, familyWatchFields } from '../members.js';
import { ROLE_LABELS, VEG_MODE_LABELS } from '../recipeschema.js';
import { NUTRIENT_LABELS } from '../foods.js';
import { dailyEstimates, mondayOf, weekKeyOf, addDays, isoDate, parseDate, MEALS, MEAL_LABELS, DAY_LABELS } from '../planner.js';
import { buildTimeline, mealNutrition, cookableSlot } from '../timeline.js';

const DEFAULT_FIELDS = ['kcal', 'protein', 'carb', 'sodium'];
const fmtMD = (iso) => { const d = parseDate(iso); return `${d.getMonth() + 1}/${d.getDate()}`; };
const dayLabel = (iso) => DAY_LABELS[(parseDate(iso).getDay() + 6) % 7];

/** 現在這個時間，比較可能在煮哪一餐。 */
export function mealByClock(hour) {
  if (hour < 10) return 'breakfast';
  if (hour < 14) return 'lunch';
  return 'dinner';
}

function emptyCard(title, body, href = '#/', linkLabel = '回本週菜單') {
  return h('section', { class: 'card', dataset: { card: 'todayEmpty' } },
    h('h2', { class: 'card-title' }, title),
    h('p', { class: 'muted' }, body),
    h('a', { class: 'btn btn-primary', href }, linkLabel),
  );
}

export default async function todayView(query = {}) {
  const todayIso = isoDate(new Date());
  const dateIso = /^\d{4}-\d{2}-\d{2}$/.test(query.d ?? '') ? query.d : todayIso;
  const meal = MEALS.includes(query.meal) ? query.meal : mealByClock(new Date().getHours());
  setTop({ title: dateIso === todayIso ? '今天一起煮' : `${fmtMD(dateIso)} 一起煮`, back: true });

  const hrefFor = (d, m) => `#/today?d=${d}&meal=${m}`;
  const mealChips = chips({
    options: MEALS.map((m) => ({ value: m, label: MEAL_LABELS[m] })), value: meal, name: 'meal',
    onChange: (m) => { location.hash = hrefFor(dateIso, m).slice(1); },
  });
  const nav = h('div', { class: 'row-actions', dataset: { field: 'todayNav' } },
    h('a', { class: 'btn btn-sm', href: hrefFor(addDays(dateIso, -1), meal), dataset: { action: 'prevDay' }, 'aria-label': '前一天' }, '‹ 前一天'),
    h('span', { class: 'muted sm' }, `${fmtMD(dateIso)}（${dayLabel(dateIso)}）`),
    h('a', { class: 'btn btn-sm', href: hrefFor(addDays(dateIso, 1), meal), dataset: { action: 'nextDay' }, 'aria-label': '後一天' }, '後一天 ›'),
  );
  const head = h('section', { class: 'card', dataset: { card: 'todayHead' } }, nav, mealChips);

  const plan = await store.getPlan(weekKeyOf(mondayOf(dateIso)));
  const slot = plan?.slots.find((s) => s.date === dateIso && s.meal === meal) ?? null;
  if (!plan || !slot) {
    render(head, emptyCard('這一天還沒有菜單', '先到「本週」產生菜單，這裡就會把當餐所有菜的步驟合成一條時間線：先一起備料、煮最久的先下鍋、盛出素食份之後兩鍋各自收尾。'));
    return;
  }
  if (!cookableSlot(slot)) {
    const why = slot.kind === 'eatOut' ? '這一餐安排的是外食。' : slot.kind === 'skip' ? '這一餐安排的是不煮。' : '這一餐沒有排到菜。';
    render(head, emptyCard(`${MEAL_LABELS[meal]}沒有要煮`, `${why}要改的話回本週菜單那一格改。`));
    return;
  }

  const members = store.members();
  const idx = store.foodsIndex();
  const recipesById = new Map(store.allRecipes().map((r) => [r.id, r]));
  const units = idx?.units ?? {};
  const tl = buildTimeline({ slot, recipesById });
  const done = await store.getCookDone(dateIso, meal);

  // ---------- 時間線 ----------
  const progress = h('p', { class: 'sm', dataset: { field: 'cookProgress' } });
  const drawProgress = () => { progress.textContent = `已完成 ${done.size}／${tl.stepCount} 步`; };
  const resetBtn = h('button', { class: 'btn btn-sm', type: 'button', dataset: { action: 'resetCook' } }, '全部重來');
  resetBtn.addEventListener('click', async () => {
    if (!done.size) { toast('還沒有勾任何一步'); return; }
    if (!(await confirmDialog('把這一餐的完成紀錄全部清掉嗎？（菜單與食譜不會變）', { okLabel: '清掉' }))) return;
    done.clear();
    await store.saveCookDone(dateIso, meal, done);
    refresh();
  });

  let stepNo = 0;
  const groupNodes = tl.groups.map((g) => h('div', { class: 'tl-group', dataset: { phase: g.phase } },
    h('h3', { class: 'tl-phase' }, g.label, ' ', pill(`${g.steps.length} 步`)),
    g.hint ? h('p', { class: 'muted xs' }, g.hint) : null,
    h('ol', { class: 'tl-list' }, ...g.steps.map((st) => {
      stepNo += 1;
      const isDone = done.has(st.id);
      const btn = h('button', {
        class: 'btn btn-sm tl-done' + (isDone ? ' btn-on' : ''), type: 'button',
        'aria-pressed': isDone ? 'true' : 'false', dataset: { action: 'stepDone', step: st.id },
        'aria-label': `第 ${stepNo} 步完成`,
      }, isDone ? '✓ 完成' : '完成');
      const li = h('li', { class: 'tl-step' + (isDone ? ' done' : ''), dataset: { step: st.id, dish: st.recipeId, done: isDone ? '1' : '0' } },
        h('div', { class: 'tl-main' },
          h('p', { class: 'tl-text' }, st.text),
          h('p', { class: 'muted xs' }, `${st.dishName}${st.stage === 'veg' ? '（素鍋）' : st.stage === 'meat' ? '（葷鍋）' : ''}`)),
        btn,
      );
      btn.addEventListener('click', async () => {
        const on = !done.has(st.id);
        if (on) done.add(st.id); else done.delete(st.id);
        li.classList.toggle('done', on);
        li.dataset.done = on ? '1' : '0';
        btn.classList.toggle('btn-on', on);
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
        btn.textContent = on ? '✓ 完成' : '完成';
        drawProgress();
        await store.saveCookDone(dateIso, meal, done);
      });
      return li;
    })),
  ));
  drawProgress();

  const timelineCard = h('section', { class: 'card', dataset: { card: 'timeline' } },
    h('h2', { class: 'card-title' }, `${MEAL_LABELS[meal]}的順序`),
    h('p', { class: 'muted sm' }, `${tl.dishes.length} 道菜、${tl.stepCount} 步；同時要顧 ${tl.potsAtOnce} 個鍋，最久的一道約 ${tl.longestMinutes} 分鐘（三道一起煮不會是各自時間相加）。`),
    h('div', { class: 'pill-row' }, ...tl.dishes.map((d) => pill(`${d.name}（${ROLE_LABELS[d.role] ?? ''}約 ${d.time} 分）`))),
    h('div', { class: 'row-actions' }, progress, resetBtn),
    ...groupNodes,
    tl.hasSplit ? h('p', { class: 'muted xs' }, '「盛出素食份」之後兩鍋分開，素食成員吃的那鍋不會再加肉；分幾份依家裡吃素的人數。') : null,
  );

  // ---------- 營養：素版一欄、葷版一欄 ----------
  const watch = familyWatchFields(members);
  const fields = watch.length ? watch : DEFAULT_FIELDS;
  const mn = mealNutrition({ slot, recipesById, idx });
  const dishNutri = mn.dishes.map((d) => h('div', { class: 'dish-nutri', dataset: { dish: d.recipeId } },
    h('p', { class: 'row-title' }, d.name, ' ', pill(VEG_MODE_LABELS[d.vegMode], d.vegMode === 'meatOnly' ? '' : 'green')),
    h('div', { class: 'track-grid' }, ...d.tracks.map((t) => h('div', { class: 'track', dataset: { track: t.version } },
      h('p', { class: 'track-label' }, `${t.label}（每人一份，這鍋 ${t.servings} 人份）`),
      ...fields.map((f) => h('div', { class: 'nutri-row' },
        h('span', {}, NUTRIENT_LABELS[f]),
        h('span', { class: 'num nutri-value', dataset: { nutrient: f, track: t.version } },
          fmtNutrient(t.est.perServing[f], units[f]),
          t.est.partial[f]?.length ? h('sup', { title: '有食材未計入' }, '＊') : null))),
    ))),
    h('a', { class: 'btn btn-sm', href: `#/recipes/${d.recipeId}` }, '看這道的食譜與全部 12 項'),
  ));

  const rows = dailyEstimates([slot], members, idx, recipesById, fields);
  const memberBlock = members.length ? h('details', { class: 'how', dataset: { field: 'mealEstimate' } },
    h('summary', {}, `這一餐每人各吃自己的版本（${members.length} 位）`),
    ...rows.map((row) => h('div', { class: 'est-row', dataset: { member: row.label } },
      h('p', { class: 'row-title' }, row.label,
        h('span', { class: 'muted xs' }, `（${DIET_LABELS[members.find((m) => m.name === row.label)?.diet] ?? ''}）`)),
      h('div', { class: 'nutri-grid' }, ...fields.map((f) => h('div', { class: 'nutri-row' },
        h('span', {}, NUTRIENT_LABELS[f]),
        h('span', { class: 'num nutri-value', dataset: { nutrient: f, member: row.label } }, fmtNutrient(row.fields[f], units[f]))))),
      row.missing ? h('p', { class: 'muted xs' }, `有 ${row.missing} 道這位吃不了，沒算進去`) : null,
    )),
    h('p', { class: 'muted xs' }, '吃素的家人算素版、吃葷的算葷版；每個人只加自己吃的那些。'),
  ) : null;

  const nutritionCard = h('section', { class: 'card', dataset: { card: 'mealNutrition' } },
    h('h2', { class: 'card-title' }, '這一餐的估計營養'),
    h('p', { class: 'muted sm', dataset: { field: 'splitNotice' } }, '可分流的菜，素版與葷版各自估算、各除各的份數，兩版不會相加。'),
    ...dishNutri,
    memberBlock,
    h('p', { class: 'muted xs' }, '數字前的「估」代表依食藥署資料庫估算，未計烹調吸油與水分變化。'),
    eduNode('fda.tfnd.attribution'),
  );

  const footer = h('section', { class: 'card', dataset: { card: 'todayFooter' } },
    h('p', { class: 'muted sm' }, '這是煮菜順序的建議排法，不是食安規範；生熟食分開、肉煮熟透請依一般常識判斷。'),
    h('a', { class: 'btn', href: '#/' }, '回本週菜單'),
  );

  render(head, timelineCard, nutritionCard, footer);
}

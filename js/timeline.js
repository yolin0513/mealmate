// 今日一起煮：把當餐所有菜的步驟合併成一條時間線（PLAN §5A）。**純函式、不碰 DOM、不碰 IndexedDB**。
//
// 這支檔案合併的是**步驟**。營養永遠是素版＝base＋veg、葷版＝base＋meat，各除各的份數、
// **兩版永遠不相加** —— 所以這裡沒有任何函式回傳「合起來」的數字：mealNutrition() 給的是
// 一道菜一到兩份**各自獨立**的估計，要相加得有人自己去寫那一行（timelinetest 與突變盯著這件事）。
//
// 合併規則（每一條都有測試與突變）：
//   1. 備料（prep）全部排在開火（cook）之前 —— 手邊有刀就一次切完
//   2. 開火的順序：煮最久的那道先下鍋（燉湯 50 分的先開火，快炒 20 分的後面再說）
//   3. 同一道菜：base 步驟 → split（盛出素食份）→ veg／meat 收尾，順序不可顛倒
//   4. 上桌（serve）最後
//
// 「這一餐要顧幾個鍋」「最久的一道幾分鐘」是事實描述，不是承諾的總時間 ——
// 三道菜同時煮不會是 50＋20＋10。

import { estimate, servingsFor } from './nutrition.js';

export const PHASES = ['prep', 'cookBase', 'split', 'veg', 'meat', 'serve'];

export const PHASE_LABELS = {
  prep: '備料（一次切完）',
  cookBase: '開火煮',
  split: '盛出素食份',
  veg: '素食那鍋收尾',
  meat: '葷食那鍋收尾',
  serve: '上桌',
};

export const PHASE_HINTS = {
  prep: '這些不用開火，先一起做完。',
  cookBase: '煮最久的先下鍋。',
  split: '這一步之後兩鍋分開，素食成員吃的那鍋不會再碰到肉。',
  veg: '素食那鍋。',
  meat: '葷食那鍋。',
  serve: '',
};

/** 一個步驟屬於哪個階段。stage 先看（分流是結構性的），再看 type。 */
export function phaseOf(step) {
  const stage = step?.stage ?? 'base';
  if (stage === 'split') return 'split';
  if (stage === 'veg') return 'veg';
  if (stage === 'meat') return 'meat';
  if (step?.type === 'prep') return 'prep';
  if (step?.type === 'serve') return 'serve';
  return 'cookBase';
}

/**
 * 這一餐的菜要照什麼順序處理：煮最久的先（同時間的維持原本排的順序）。
 * @param dishes [{ recipe, ... }]
 */
export function dishOrder(dishes) {
  return dishes
    .map((d, i) => ({ d, i }))
    .sort((a, b) => (b.d.recipe.time ?? 0) - (a.d.recipe.time ?? 0) || a.i - b.i)
    .map((x) => x.d);
}

/** 這一格有沒有東西可以煮。 */
export function cookableSlot(slot) {
  return !!slot && slot.kind === 'cook' && Array.isArray(slot.items) && slot.items.length > 0;
}

/**
 * 把一格（一餐）的所有菜合併成一條時間線。
 * @returns {{
 *   dishes: [{ recipeId, name, role, time, vegMode, recipe }],
 *   groups: [{ phase, label, hint, steps: [{ id, recipeId, dishName, stage, type, text }] }],
 *   stepCount, longestMinutes, potsAtOnce, hasSplit
 * }}
 */
export function buildTimeline({ slot, recipesById }) {
  const empty = { dishes: [], groups: [], stepCount: 0, longestMinutes: 0, potsAtOnce: 0, hasSplit: false };
  if (!cookableSlot(slot)) return empty;

  const dishes = [];
  for (const it of slot.items) {
    const recipe = recipesById.get(it.recipeId);
    if (!recipe) continue;
    dishes.push({ recipeId: recipe.id, name: recipe.name, role: it.role ?? recipe.role, time: recipe.time ?? 0, vegMode: recipe.vegMode, recipe });
  }
  if (!dishes.length) return empty;

  const ordered = dishOrder(dishes);
  const groups = PHASES.map((phase) => ({ phase, label: PHASE_LABELS[phase], hint: PHASE_HINTS[phase], steps: [] }));
  const byPhase = new Map(groups.map((g) => [g.phase, g]));

  for (const dish of ordered) {
    dish.recipe.steps.forEach((st, i) => {
      byPhase.get(phaseOf(st)).steps.push({
        id: `${dish.recipeId}#${i}`,
        recipeId: dish.recipeId,
        dishName: dish.name,
        stage: st.stage ?? 'base',
        type: st.type ?? 'cook',
        text: st.text,
      });
    });
  }

  const used = groups.filter((g) => g.steps.length > 0);
  return {
    dishes: ordered.map(({ recipe, ...rest }) => ({ ...rest, recipe })),
    groups: used,
    stepCount: used.reduce((n, g) => n + g.steps.length, 0),
    longestMinutes: Math.max(...ordered.map((d) => d.time ?? 0)),
    potsAtOnce: ordered.filter((d) => d.recipe.steps.some((st) => (st.type ?? 'cook') !== 'prep')).length,
    hasSplit: ordered.some((d) => d.vegMode === 'splittable'),
  };
}

/**
 * 這一餐每道菜的估計營養。**一道可分流的菜回兩份各自獨立的估計，沒有合起來的那一份。**
 * @returns {{ dishes: [{ recipeId, name, vegMode, tracks: [{ version, label, servings, est }] }] }}
 */
export function mealNutrition({ slot, recipesById, idx }) {
  const out = { dishes: [] };
  if (!cookableSlot(slot) || !idx) return out;
  for (const it of slot.items) {
    const r = recipesById.get(it.recipeId);
    if (!r) continue;
    const versions = r.vegMode === 'splittable' ? ['veg', 'meat'] : ['all'];
    out.dishes.push({
      recipeId: r.id,
      name: r.name,
      vegMode: r.vegMode,
      tracks: versions.map((version) => ({
        version,
        label: version === 'veg' ? '素版' : version === 'meat' ? '葷版' : '全家同一鍋',
        servings: servingsFor(r, version),
        est: estimate(r, idx, { version }),
      })),
    });
  }
  return out;
}

// 今日一起煮的時間線（npm run timelinetest）。純函式，用真的食譜。
//
// 守的事（每條都對應一條突變）：
//   · 備料全部在開火之前
//   · 煮最久的那道先下鍋
//   · 同一道菜：base → split → veg／meat，順序不可顛倒
//   · 上桌最後
//   · **時間線只合併步驟，不合併營養**：可分流的菜回素版與葷版兩份各自獨立的估計，
//     沒有任何一份等於兩者相加（這是這個 App 的核心紅線）

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ok, eq, section, done, everyOf, noneOf, near } from './tap.mjs';
import { indexFoods } from '../js/foods.js';
import { estimate } from '../js/nutrition.js';
import { NUTRIENT_ORDER } from '../js/foods.js';
import { buildTimeline, mealNutrition, phaseOf, dishOrder, cookableSlot, PHASES, PHASE_LABELS } from '../js/timeline.js';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const foods = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/foods.json'), 'utf8'));
const aliases = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/aliases.json'), 'utf8'));
const recipes = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/recipes.json'), 'utf8')).recipes;
const idx = indexFoods(foods, aliases);
const byId = new Map(recipes.map((r) => [r.id, r]));

const SOUP = 'r-corn-rib-soup-split';       // 湯 50 分、可分流
const MAIN = 'r-cabbage-pork-stirfry';      // 主菜 20 分、可分流
const SIDE = 'r-stir-fried-cabbage';        // 配菜、不分流
const slotOf = (ids, kind = 'cook') => ({
  day: 0, date: '2026-09-14', meal: 'dinner', kind,
  items: ids.map((id) => ({ recipeId: id, role: byId.get(id).role, locked: false, reasons: [] })),
});

section('前提：拿到的是真的食譜');
everyOf([SOUP, MAIN, SIDE], (id) => byId.has(id), '三道菜都在資料裡');
eq(byId.get(SOUP).time, 50, `${byId.get(SOUP).name} 是 50 分鐘`);
eq(byId.get(MAIN).time, 20, `${byId.get(MAIN).name} 是 20 分鐘`);
eq(byId.get(SOUP).vegMode, 'splittable', '湯可分流');
eq(byId.get(SIDE).vegMode, 'nativeVeg', '配菜本身就是素的（不分流）');

section('階段判定');
eq(phaseOf({ stage: 'base', type: 'prep' }), 'prep', '共同備料 → 備料');
eq(phaseOf({ stage: 'base', type: 'cook' }), 'cookBase', '共同烹煮 → 開火煮');
eq(phaseOf({ stage: 'split', type: 'split' }), 'split', '分流 → 盛出素食份');
eq(phaseOf({ stage: 'veg', type: 'cook' }), 'veg', '素鍋 → 素食那鍋收尾');
eq(phaseOf({ stage: 'meat', type: 'cook' }), 'meat', '葷鍋 → 葷食那鍋收尾');
eq(phaseOf({ stage: 'base', type: 'serve' }), 'serve', '上桌 → 上桌');
eq(phaseOf({ stage: 'veg', type: 'serve' }), 'veg', '素鍋的上桌步驟仍屬素鍋（不可以被拉到共同階段）');
eq(PHASES.indexOf('split') > PHASES.indexOf('cookBase'), true, '盛出素食份排在共同烹煮之後');
eq(PHASES.indexOf('veg') > PHASES.indexOf('split'), true, '素鍋收尾排在盛出之後');
eq(PHASES.indexOf('meat') > PHASES.indexOf('split'), true, '葷鍋收尾排在盛出之後');

section('三道菜合成一條時間線');
const tl = buildTimeline({ slot: slotOf([MAIN, SIDE, SOUP]), recipesById: byId });
const flat = tl.groups.flatMap((g) => g.steps.map((s) => ({ ...s, phase: g.phase })));
const at = (pred) => flat.findIndex(pred);
eq(tl.stepCount, byId.get(MAIN).steps.length + byId.get(SIDE).steps.length + byId.get(SOUP).steps.length, '三道菜的步驟一步都沒少');
ok(tl.stepCount >= 12, `（母體）合起來 ${tl.stepCount} 步`);
eq(flat.length, tl.stepCount, '每一步都在某個階段裡');
eq(new Set(flat.map((s) => s.id)).size, flat.length, '每一步有自己的編號（勾完成才不會勾錯）');
eq(tl.groups.map((g) => g.phase), PHASES.filter((p) => tl.groups.some((g) => g.phase === p)), '階段照固定順序');
everyOf(tl.groups, (g) => g.steps.length > 0, '沒有空的階段（空的不顯示）');
everyOf(tl.groups, (g) => PHASE_LABELS[g.phase] === g.label, '每個階段都有標題');

section('備料全部在開火之前');
const prepIdx = flat.map((s, i) => (s.phase === 'prep' ? i : -1)).filter((i) => i >= 0);
const cookIdx = flat.map((s, i) => (s.phase === 'cookBase' ? i : -1)).filter((i) => i >= 0);
ok(prepIdx.length >= 3, `（母體）${prepIdx.length} 個備料步驟`);
ok(cookIdx.length >= 3, `（母體）${cookIdx.length} 個開火步驟`);
ok(Math.max(...prepIdx) < Math.min(...cookIdx), `最後一個備料（第 ${Math.max(...prepIdx) + 1} 步）排在第一個開火（第 ${Math.min(...cookIdx) + 1} 步）之前`);

section('煮最久的那道先下鍋');
const firstCookOf = (id) => at((s) => s.phase === 'cookBase' && s.recipeId === id);
ok(firstCookOf(SOUP) >= 0 && firstCookOf(MAIN) >= 0, '（前提）湯與主菜都有開火步驟');
ok(firstCookOf(SOUP) < firstCookOf(MAIN), `50 分的湯（第 ${firstCookOf(SOUP) + 1} 步）比 20 分的炒菜（第 ${firstCookOf(MAIN) + 1} 步）先開火`);
eq(dishOrder([{ recipe: { time: 10 } }, { recipe: { time: 50 } }, { recipe: { time: 30 } }]).map((d) => d.recipe.time), [50, 30, 10], '排序是由久到短');
eq(dishOrder([{ recipe: { time: 20 }, tag: 'a' }, { recipe: { time: 20 }, tag: 'b' }]).map((d) => d.tag), ['a', 'b'], '一樣久就維持原本的順序（同輸入同輸出）');
eq(tl.longestMinutes, 50, '最久的一道 50 分鐘');
eq(tl.potsAtOnce, 3, '這一餐三個鍋要顧');

section('同一道菜：base → split → veg／meat');
for (const id of [MAIN, SOUP]) {
  const mine = flat.map((s, i) => ({ ...s, i })).filter((s) => s.recipeId === id);
  const splitAt = mine.find((s) => s.phase === 'split')?.i;
  ok(splitAt != null, `${byId.get(id).name} 有「盛出素食份」那一步`);
  const bases = mine.filter((s) => s.stage === 'base');
  const finals = mine.filter((s) => s.stage === 'veg' || s.stage === 'meat');
  ok(bases.length >= 2 && finals.length >= 2, `（母體）${byId.get(id).name}：共同 ${bases.length} 步、分流後 ${finals.length} 步`);
  everyOf(bases, (s) => s.i < splitAt, `${byId.get(id).name} 的共同步驟都在盛出之前`);
  everyOf(finals, (s) => s.i > splitAt, `${byId.get(id).name} 的素／葷收尾都在盛出之後`);
}
const vegIdx = flat.map((s, i) => (s.phase === 'veg' ? i : -1)).filter((i) => i >= 0);
const meatIdx = flat.map((s, i) => (s.phase === 'meat' ? i : -1)).filter((i) => i >= 0);
ok(vegIdx.length >= 2 && meatIdx.length >= 2, `（母體）素鍋 ${vegIdx.length} 步、葷鍋 ${meatIdx.length} 步`);
ok(Math.max(...vegIdx) < Math.min(...meatIdx), '素鍋收尾整段排在葷鍋收尾之前（素的先離開爐火，不會沾到肉）');

section('不分流的菜不會憑空多出分流步驟');
const tlSide = buildTimeline({ slot: slotOf([SIDE]), recipesById: byId });
eq(tlSide.hasSplit, false, '這一餐沒有可分流的菜');
noneOf(tlSide.groups, (g) => ['split', 'veg', 'meat'].includes(g.phase), '沒有盛出、素鍋、葷鍋這三個階段');
ok(tlSide.stepCount >= 3, `（對照）步驟還是照樣列出來（${tlSide.stepCount} 步）`);
eq(buildTimeline({ slot: slotOf([MAIN, SOUP]), recipesById: byId }).hasSplit, true, '（對照）有可分流的菜時 hasSplit 是 true');

section('外食、不煮、空的格子沒有時間線');
eq(cookableSlot(slotOf([MAIN], 'eatOut')), false, '外食那一格不煮');
eq(buildTimeline({ slot: slotOf([MAIN], 'eatOut'), recipesById: byId }).stepCount, 0, '外食 → 零步驟');
eq(buildTimeline({ slot: slotOf([MAIN], 'skip'), recipesById: byId }).stepCount, 0, '不煮 → 零步驟');
eq(buildTimeline({ slot: slotOf([]), recipesById: byId }).stepCount, 0, '沒有菜 → 零步驟');
eq(buildTimeline({ slot: null, recipesById: byId }).stepCount, 0, '沒有這一格 → 零步驟');

section('營養：素版葷版各自一份，永遠沒有合起來的那一份');
const mn = mealNutrition({ slot: slotOf([MAIN, SIDE, SOUP]), recipesById: byId, idx });
eq(mn.dishes.length, 3, '三道菜都有估計');
const splitDishes = mn.dishes.filter((d) => d.vegMode === 'splittable');
ok(splitDishes.length === 2, `（母體）兩道可分流的菜`);
everyOf(splitDishes, (d) => d.tracks.length === 2, '可分流的菜剛好兩份估計');
everyOf(splitDishes, (d) => d.tracks.map((t) => t.version).join() === 'veg,meat', '一份素版、一份葷版');
everyOf(mn.dishes.filter((d) => d.vegMode !== 'splittable'), (d) => d.tracks.length === 1 && d.tracks[0].version === 'all', '不分流的菜只有一份');

// 手算對照：素版＝base＋veg 軌、葷版＝base＋meat 軌，各除各的份數 —— 跟 nutrition.estimate 同一條路。
for (const d of splitDishes) {
  const r = byId.get(d.recipeId);
  const veg = d.tracks.find((t) => t.version === 'veg');
  const meat = d.tracks.find((t) => t.version === 'meat');
  near(veg.est.perServing.kcal, estimate(r, idx, { version: 'veg' }).perServing.kcal, 0.001, `${r.name} 素版熱量跟 estimate(veg) 一致`);
  near(meat.est.perServing.kcal, estimate(r, idx, { version: 'meat' }).perServing.kcal, 0.001, `${r.name} 葷版熱量跟 estimate(meat) 一致`);
  eq(veg.servings, r.splitServings.veg, `${r.name} 素版是 ${r.splitServings.veg} 人份`);
  eq(meat.servings, r.splitServings.meat, `${r.name} 葷版是 ${r.splitServings.meat} 人份`);
  ok(veg.est.perServing.protein !== meat.est.perServing.protein, `${r.name} 素版與葷版的蛋白質不一樣（真的分開算）`);
}

// 紅線：不管翻遍回傳值的哪一個角落，都不可以出現「素＋葷」那個數字。
//
// 只收**兩邊都大於 0** 的欄位：素版膽固醇是 0 的時候，「素＋葷」剛好等於葷版自己那個數字，
// 那個和本來就該出現在回傳值裡 —— 拿它當反例會誤判（第一版就是這樣紅的）。
// 兩邊都 > 0 時，和一定嚴格大於任何一版，才是一個「不該存在」的數字。
const sums = [];
for (const d of splitDishes) {
  const veg = d.tracks.find((t) => t.version === 'veg').est;
  const meat = d.tracks.find((t) => t.version === 'meat').est;
  for (const k of NUTRIENT_ORDER) {
    if (!(veg.perServing[k] > 0) || !(meat.perServing[k] > 0)) continue;
    sums.push({ dish: d.name, k, value: veg.perServing[k] + meat.perServing[k] });
    if (veg.total?.[k] > 0 && meat.total?.[k] > 0) sums.push({ dish: d.name, k, value: veg.total[k] + meat.total[k] });
  }
}
ok(sums.length >= 20, `（母體）檢查了 ${sums.length} 個「素＋葷」的和（兩版都不是 0 的欄位）`);
everyOf(sums, (s) => s.value > 0, '每一個和都是正數（不是拿 0 當反例）');
const allNumbers = [];
(function walk(v) {
  if (typeof v === 'number' && Number.isFinite(v)) { allNumbers.push(v); return; }
  if (Array.isArray(v)) { v.forEach(walk); return; }
  if (v && typeof v === 'object') { Object.values(v).forEach(walk); }
}(mn));
ok(allNumbers.length >= 100, `（母體）回傳值裡有 ${allNumbers.length} 個數字`);
noneOf(sums, (s) => allNumbers.some((n) => Math.abs(n - s.value) < 0.0001), '**回傳值裡沒有任何一個數字等於素版＋葷版**');
// 對照組：這個檢查器抓得到 —— 真的把兩版加起來塞進去就會被抓出來
const poisoned = JSON.parse(JSON.stringify(mn));
poisoned.dishes[0].tracks[0].est.perServing.kcalCombined = sums[0].value;
const poisonedNumbers = [];
(function walk(v) {
  if (typeof v === 'number' && Number.isFinite(v)) { poisonedNumbers.push(v); return; }
  if (Array.isArray(v)) { v.forEach(walk); return; }
  if (v && typeof v === 'object') { Object.values(v).forEach(walk); }
}(poisoned));
ok(poisonedNumbers.some((n) => Math.abs(n - sums[0].value) < 0.0001), '（對照）把和塞進去，這個檢查器抓得到');

section('沒有食材資料時不假裝算得出來');
eq(mealNutrition({ slot: slotOf([MAIN]), recipesById: byId, idx: null }).dishes.length, 0, '沒有 foods 索引 → 不回任何估計（畫面顯示未估算）');

done('timelinetest');

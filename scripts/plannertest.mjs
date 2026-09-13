// 週計畫規劃器（npm run plannertest）。純函式，用真的 90 道食譜與合成池。
//
// 守的事（每條都對應一條突變）：
//   · 同種子同輸入 → 同輸出
//   · 主菜池 ≥ 40：4 週主菜 14 天內不重複；池子縮到 10 道 → diagnostics.forcedRepeats 非空
//   · 早餐不吃不重複扣分（同一道可以週一、週三重複）
//   · 慢性病只降分：池子只剩高醣主菜時，糖尿病家庭仍排得出主菜，理由講事實
//   · 腎臟病沒勾「鉀」時，鉀不影響分數
//   · 有素食成員：每格的每道菜都是每位素食成員吃得了的版本；meatOnly 不會出現
//   · 保存期限：葉菜不會排在買菜日後第 4 天以上
//   · 鎖住的格子重新產生後不變；外食格沒有菜
//   · 理由只有事實，沒有建議語氣

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ok, eq, section, done, everyOf, noneOf, detects } from './tap.mjs';
import { indexFoods } from '../js/foods.js';
import { newMember } from '../js/members.js';
import {
  generateWeek, swapItem, buildContext, scoreSoft, hardBlock, makeRng, hashSeed, weekKeyOf, mondayOf, addDays,
  lastShoppingDayOnOrBefore, historyRowsOf, dailyEstimates, medianOf, MEALS, isMeaty, VEG_MIN_DISHES, withPositions,
  actualRelaxations, shelfBlocker, RELAXABLE, FREEZABLE_CATS, daysBetween,
} from '../js/planner.js';
import { shelfDaysFor } from '../js/units.js';
import { versionFor } from '../js/members.js';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const foods = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/foods.json'), 'utf8'));
const aliases = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/aliases.json'), 'utf8'));
const units = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/units.json'), 'utf8'));
const recipes = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/recipes.json'), 'utf8')).recipes;
const idx = indexFoods(foods, aliases);
const byId = new Map(recipes.map((r) => [r.id, r]));
const MONDAY = '2026-09-14'; // 週一
const cookSlots = (plan) => plan.slots.filter((s) => s.kind === 'cook');
const mainsOf = (plan) => cookSlots(plan).flatMap((s) => s.items.filter((it) => it.role === 'main').map((it) => ({ ...it, date: s.date, meal: s.meal })));
const gen = (over = {}) => generateWeek({ recipes, members: [], idx, units, favorites: [], history: [], mondayIso: MONDAY, seed: 'test', shoppingDays: [3, 6], ...over });

section('日期與亂數工具');
eq(mondayOf('2026-09-16'), '2026-09-14', '週三 → 該週週一');
eq(mondayOf('2026-09-13'), '2026-09-07', '週日 → 前一個週一（一週從週一開始）');
eq(weekKeyOf('2026-09-14'), '2026-W38', 'ISO 週編號');
eq(addDays('2026-09-30', 1), '2026-10-01', '跨月');
eq(lastShoppingDayOnOrBefore('2026-09-18', [3, 6]), '2026-09-16', '週五往回找到週三買菜日');
eq(lastShoppingDayOnOrBefore('2026-09-16', [3, 6]), '2026-09-16', '買菜日當天就是自己');
eq(lastShoppingDayOnOrBefore('2026-09-16', []), null, '沒設買菜日 → null');
const r1 = makeRng('abc'); const r2 = makeRng('abc'); const r3 = makeRng('abd');
eq([r1(), r1(), r1()], [r2(), r2(), r2()], '同 seed 同序列');
ok(r1() !== r3() || r1() !== r3(), '不同 seed 不同序列');
ok(hashSeed('a') !== hashSeed('b'), 'hash 分得開');
eq(medianOf([3, 1, 2]), 2, '中位數（奇數）');
eq(medianOf([1, 2, 3, 4]), 2.5, '中位數（偶數）');
eq(medianOf([5]), null, '只有一個值沒有中位數');

section('確定性：同種子同輸入 → 同輸出');
const a = gen(); const b = gen();
eq(JSON.stringify(a.plan.slots), JSON.stringify(b.plan.slots), '兩次產生的 21 格完全一樣');
eq(a.plan.slots.length, 21, '7 天 × 3 餐 = 21 格');
const c = gen({ seed: 'other' });
ok(JSON.stringify(c.plan.slots) !== JSON.stringify(a.plan.slots), '換 seed 結果不同（不是每次都排同一套）');
eq(a.plan.weekKey, '2026-W38', '週編號');
everyOf(cookSlots(a.plan).filter((s) => s.meal !== 'breakfast'), (s) => s.items.some((it) => it.role === 'main'), '每個午晚餐都有主菜');
everyOf(cookSlots(a.plan).filter((s) => s.meal === 'dinner'), (s) => s.items.some((it) => it.role === 'soup'), '每個晚餐都有湯');
everyOf(cookSlots(a.plan).filter((s) => s.meal === 'breakfast'), (s) => s.items.length === 1 && s.items[0].role === 'breakfast', '早餐一道');
everyOf(cookSlots(a.plan).flatMap((s) => s.items), (it) => Array.isArray(it.reasons) && it.reasons.length >= 2, '每道菜都有 ≥ 2 條理由');
everyOf(cookSlots(a.plan).filter((s) => s.meal !== 'breakfast'), (s) => {
  const main = byId.get(s.items.find((it) => it.role === 'main').recipeId);
  return main.includesStaple ? !s.items.some((it) => it.role === 'staple') : s.items.some((it) => it.role === 'staple');
}, '主菜本身含主食（炒米粉、螞蟻上樹）就不另排主食，否則要有主食');

section('主菜 14 天內不重複（池子 48 道主菜）');
ok(a.diagnostics.poolSizes.main >= 40, `（母體）主菜池 ${a.diagnostics.poolSizes.main} 道`);
// 連排 4 週，每週把上一週寫進 history
let hist = [];
const weeks = [];
for (let w = 0; w < 4; w += 1) {
  const monday = addDays(MONDAY, 7 * w);
  const { plan, diagnostics } = gen({ history: hist, mondayIso: monday });
  weeks.push({ plan, diagnostics });
  hist = [...hist, ...historyRowsOf(plan)];
}
const allMains = weeks.flatMap(({ plan }) => mainsOf(plan));
ok(allMains.length === 56, `（母體）4 週共 ${allMains.length} 個主菜格`);
const violations = [];
for (let i = 0; i < allMains.length; i += 1) for (let j = i + 1; j < allMains.length; j += 1) {
  if (allMains[i].recipeId === allMains[j].recipeId) {
    const diff = Math.abs((new Date(allMains[j].date) - new Date(allMains[i].date)) / 86400000);
    if (diff <= 14) violations.push(`${allMains[i].recipeId} ${allMains[i].date}/${allMains[j].date}`);
  }
}
eq(violations, [], '4 週裡沒有任何主菜在 14 天內重複');
eq(weeks.flatMap((w) => w.diagnostics.forcedRepeats).filter((f) => f.role === 'main'), [], '主菜池夠大時，主菜沒有任何一筆被迫重複');
// 湯只有 10 道、平日晚餐上限 40 分鐘又擋掉三道慢湯，7 天內重複是誠實的診斷 —— 這裡只確認它有被記下來、沒有靜默
const soupRepeats = weeks.flatMap((w) => w.diagnostics.forcedRepeats).filter((f) => f.role === 'soup');
ok(soupRepeats.every((f) => f.daysAgo <= 7 && byId.get(f.recipeId)?.role === 'soup'), `湯若被迫重複（${soupRepeats.length} 筆）都有記在 diagnostics`);
// 同一天不排同一道菜
const sameDayDup = weeks.flatMap(({ plan }) => {
  const byDate = new Map();
  for (const s of cookSlots(plan)) for (const it of s.items) { const k = `${s.date}|${it.recipeId}`; byDate.set(k, (byDate.get(k) ?? 0) + 1); }
  return [...byDate].filter(([, n]) => n > 1).map(([k]) => k);
});
eq(sameDayDup, [], '4 週裡沒有任何一天同一道菜出現兩餐');

section('池子不夠時明講');
const smallMains = recipes.filter((r) => r.role === 'main').slice(0, 10).map((r) => r.id);
const smallPool = recipes.filter((r) => r.role !== 'main' || smallMains.includes(r.id));
const { plan: sp, diagnostics: sd } = gen({ recipes: smallPool });
ok(sd.poolSizes.main === 10, `（前提）主菜池縮到 ${sd.poolSizes.main} 道`);
ok(sd.forcedRepeats.length > 0, `diagnostics.forcedRepeats 有 ${sd.forcedRepeats.length} 筆`);
everyOf(sd.forcedRepeats, (f) => f.role === 'main' && f.daysAgo <= 14 && byId.get(f.recipeId), '每一筆都寫出是哪一格、哪道菜、上次是幾天前');
ok(mainsOf(sp).length === 14, '（同時）每個午晚餐還是有主菜，沒有空格');
const repeatedReason = mainsOf(sp).flatMap((it) => it.reasons).find((t) => /天內重複/.test(t));
ok(!!repeatedReason, `重複的那道菜理由講明：${repeatedReason}`);

section('早餐不吃不重複扣分');
const bfPool = recipes.filter((r) => r.role !== 'breakfast' || r.id === 'r-egg-toast' || r.id === 'r-oat-soymilk');
const { plan: bp, diagnostics: bd } = gen({ recipes: bfPool });
const bfs = cookSlots(bp).filter((s) => s.meal === 'breakfast').map((s) => s.items[0].recipeId);
eq(bfs.length, 7, '（母體）七個早餐');
ok(new Set(bfs).size <= 2 && bfs.length === 7, '只有兩道早餐時七天輪著吃，同一道當然會重複');
eq(bd.forcedRepeats.filter((f) => f.role === 'breakfast'), [], '早餐重複不算「被迫重複」（noRepeatDays.breakfast 是 0）');
noneOf(cookSlots(bp).filter((s) => s.meal === 'breakfast').flatMap((s) => s.items[0].reasons), (t) => /天內重複/.test(t), '早餐的理由裡沒有「天內重複」');

section('慢性病只降分、不排除');
const diabetic = { ...newMember(), name: '阿嬤', conditions: ['diabetes'] };
const mainsSorted = recipes.filter((r) => r.role === 'main').map((r) => {
  const ctx0 = buildContext({ recipes, members: [diabetic], idx, units });
  return { r, carb: ctx0.watchedValue(r, 'carb') };
}).filter((x) => x.carb != null).sort((x, y) => y.carb - x.carb);
const highCarb = mainsSorted.slice(0, 6).map((x) => x.r.id);
ok(highCarb.length === 6, `（前提）挑出醣最高的 6 道主菜：${highCarb.map((id) => byId.get(id).name).join('、')}`);
const highPool = recipes.filter((r) => r.role !== 'main' || highCarb.includes(r.id));
const { plan: hp } = gen({ recipes: highPool, members: [diabetic] });
eq(mainsOf(hp).length, 14, '池子只剩高醣主菜時，糖尿病家庭的 14 個午晚餐**還是都有主菜**（沒有被排除）');
everyOf(mainsOf(hp), (it) => highCarb.includes(it.recipeId), '排的都是那 6 道');
const carbReason = mainsOf(hp).flatMap((it) => it.reasons).find((t) => /估 碳水化合物（醣）/.test(t));
ok(!!carbReason, `理由講出醣的估計值與中位數：${carbReason}`);
// 對照：同一個池子，降分真的存在 —— 高醣的分數低於低醣的
{
  const ctx = buildContext({ recipes, members: [diabetic], idx, units, shoppingDays: [] });
  const state = { slotItems: [], placedWant: new Set(), lastServed: () => null, timesServedWithin: () => 0, dayProteins: () => new Set(), prevDayMealProteins: () => new Set(), fishCount: () => 0, rangeHas: () => false };
  const slot = { role: 'main', meal: 'dinner', date: '2026-09-14', day: 0 };
  const hi = mainsSorted[0].r; const lo = mainsSorted[mainsSorted.length - 1].r;
  const sHi = scoreSoft(hi, slot, ctx, state, () => 0).score; const sLo = scoreSoft(lo, slot, ctx, state, () => 0).score;
  ok(sLo > sHi, `（對照）醣最低的 ${lo.name} 分數 ${sLo.toFixed(1)} > 醣最高的 ${hi.name} 分數 ${sHi.toFixed(1)}：降分是真的`);
  eq(hardBlock(hi, slot, ctx, state), null, '（對照）但醣最高的那道並沒有被硬約束擋掉');
}

section('留意欄位是扣分不是排除：高醣的菜對上「昨天才吃過」的低醣菜，會選高醣的');
{
  // 只放兩道主菜：醣最低與醣最高（都要能在平日午餐 35 分鐘內煮好）。低醣那道昨天剛吃過 → 扣 100；
  // 高醣那道只因為高於中位數扣 12。扣分制會選高醣的；「改成排除」會選昨天吃過的（被迫重複）。
  const quick = mainsSorted.filter((x) => x.r.time <= 30);
  const lowMain = quick[quick.length - 1].r; const highMain = quick[0].r;
  ok(lowMain.id !== highMain.id && highMain.time <= 30 && lowMain.time <= 30, `（前提）低醣 ${lowMain.name}、高醣 ${highMain.name}`);
  const twoPool = [...recipes.filter((r) => r.role !== 'main'), lowMain, highMain];
  const yesterday = addDays(MONDAY, -1);
  const { plan: tp } = gen({ recipes: twoPool, members: [diabetic], shoppingDays: [], history: [{ date: yesterday, recipeId: lowMain.id, meal: 'dinner', role: 'main', weekKey: 'prev' }] });
  const mondayLunch = tp.slots.find((s) => s.day === 0 && s.meal === 'lunch').items.find((it) => it.role === 'main');
  eq(mondayLunch.recipeId, highMain.id, `週一午餐選了高醣但沒吃過的 ${highMain.name}，不是昨天吃過的 ${lowMain.name}（高於中位數只是扣分）`);
  ok(mondayLunch.reasons.some((t) => /高於主菜池子的中位數/.test(t)), `理由誠實寫出它高於中位數：${mondayLunch.reasons.find((t) => /中位數/.test(t))}`);
}

section('腎臟病沒勾「鉀」→ 鉀不影響分數');
{
  const noWatch = { ...newMember(), name: '爸', conditions: ['kidney'], kidneyWatch: [] };
  const watchK = { ...newMember(), name: '爸', conditions: ['kidney'], kidneyWatch: ['potassium'] };
  const mains = recipes.filter((r) => r.role === 'main');
  const ctxNone = buildContext({ recipes, members: [noWatch], idx, units });
  const ctxK = buildContext({ recipes, members: [watchK], idx, units });
  const ctxNobody = buildContext({ recipes, members: [], idx, units });
  const state = { slotItems: [], placedWant: new Set(), lastServed: () => null, timesServedWithin: () => 0, dayProteins: () => new Set(), prevDayMealProteins: () => new Set(), fishCount: () => 0, rangeHas: () => false };
  const slot = { role: 'main', meal: 'dinner', date: '2026-09-14', day: 0 };
  const scores = (ctx) => mains.map((r) => scoreSoft(r, slot, ctx, state, () => 0).score);
  eq(scores(ctxNone), scores(ctxNobody), '腎臟病沒勾任何子項：每道主菜的分數跟沒有家人時一模一樣（不自動限鉀）');
  ok(scores(ctxK).some((s, i) => s !== scores(ctxNobody)[i]), '（對照）勾了鉀之後分數才會變');
  eq(ctxNone.watchers.size, 0, '（結構）沒勾子項 → 沒有任何留意欄位');
  eq([...ctxK.watchers.keys()], ['potassium'], '勾鉀 → 只有鉀');
}

section('素食成員：每格每道菜都吃得了');
const fam = [{ ...newMember(), name: '爸', diet: 'omni' }, { ...newMember(), name: '媽', diet: 'lactoOvo' }, { ...newMember(), name: '姊', diet: 'veganNoAllium' }];
const { plan: vp } = gen({ members: fam });
const vItems = cookSlots(vp).flatMap((s) => s.items.map((it) => byId.get(it.recipeId)));
ok(vItems.length >= 50, `（母體）${vItems.length} 道菜`);
everyOf(vItems, (r) => versionFor(r, 'lactoOvo') !== null && versionFor(r, 'veganNoAllium') !== null, '每一道菜蛋奶素與全素不含五辛的成員都吃得了');
noneOf(vItems, (r) => r.vegMode === 'meatOnly', '沒有任何 meatOnly 的菜');
ok(vItems.some((r) => r.vegMode === 'splittable'), '（對照）有可分流的菜（葷食成員吃葷版），不是全變成素菜');
ok(cookSlots(vp).flatMap((s) => s.items).some((it) => it.reasons.some((t) => t.includes('姊（全素不含五辛）可吃'))), '理由寫出「姊（全素不含五辛）可吃」');
ok(recipes.some((r) => r.role === 'main' && r.vegMode === 'meatOnly'), '（對照母體）池子裡本來有 meatOnly 主菜');

section('保存期限：葉菜不排在買菜日後第 4 天以上');
const leafyIds = new Set(['E3200602', 'E3201202', 'E5600102', 'E5000101', 'E3100101', 'E4600101', 'E3900101', 'E4800101']); // 小白菜、青江菜、空心菜、菠菜、地瓜葉、茼蒿、芥藍、莧菜
const { plan: shelfPlan } = gen({ shoppingDays: [1] }); // 只有週一買菜
const leafyUses = cookSlots(shelfPlan).flatMap((s) => s.items.map((it) => ({ date: s.date, r: byId.get(it.recipeId) })))
  .filter(({ r }) => r.ingredients.some((ing) => leafyIds.has(ing.food)));
ok(leafyUses.length >= 1, `（母體）這週排了 ${leafyUses.length} 道有葉菜的菜`);
everyOf(leafyUses, ({ date }) => (new Date(date) - new Date('2026-09-14')) / 86400000 <= 3, '每一道都在週一買菜日後 3 天內（週一到週四）');
const lateDays = cookSlots(shelfPlan).filter((s) => (new Date(s.date) - new Date('2026-09-14')) / 86400000 > 3);
ok(lateDays.length >= 9 && lateDays.every((s) => s.items.length > 0), '（對照）週五到週日照樣有菜，只是沒有葉菜');

section('放寬的限制要少：主食不算時間上限、只有炸與湯互斥');
{
  const { plan: rp, diagnostics: rd } = gen({ members: [{ ...newMember(), name: '爸' }, { ...newMember(), name: '阿嬤', diet: 'lactoOvo', conditions: ['diabetes'] }] });
  ok(rd.relaxed.length <= 2, `兩人家庭一週只放寬 ${rd.relaxed.length} 次（≤ 2）：${JSON.stringify(rd.relaxed)}`);
  const dinnerSoups = cookSlots(rp).filter((s) => s.meal === 'dinner').map((s) => s.items.filter((it) => byId.get(it.recipeId).method === 'soup').length);
  everyOf(dinnerSoups, (n) => n === 1, '每個晚餐剛好一道湯類烹法的菜（湯互斥）');
  const staples = cookSlots(rp).flatMap((s) => s.items.filter((it) => it.role === 'staple').map((it) => byId.get(it.recipeId).name));
  ok(new Set(staples).size >= 2, `主食有輪替（${[...new Set(staples)].join('、')}），電鍋時間（白飯 45 分、糙米 70 分）不被算進晚餐時間上限`);
  const { hardBlock: hb, buildContext: bc } = await import('../js/planner.js');
  const ctx = bc({ recipes, members: [], idx, units, shoppingDays: [] });
  const stirfryMain = recipes.find((r) => r.role === 'main' && r.method === 'stirfry');
  const stirfrySide = recipes.find((r) => r.role === 'side' && r.method === 'stirfry');
  eq(hb(stirfrySide, { role: 'side', meal: 'dinner', date: '2026-09-14' }, ctx, { slotItems: [{ recipeId: stirfryMain.id, role: 'main', method: 'stirfry' }], dayRecipes: () => new Set() }), null, '主菜是炒、配菜也是炒 → 不衝突');
  const soupA = recipes.find((r) => r.role === 'soup' && r.method === 'soup' && r.time <= 30);
  eq(hb(soupA, { role: 'soup', meal: 'dinner', date: '2026-09-14' }, ctx, { slotItems: [{ recipeId: 'x', role: 'main', method: 'soup' }], dayRecipes: () => new Set() }), 'method', '（對照）同一餐已有湯類烹法的菜 → 湯衝突');
  const rice = byId.get('r-brown-rice');
  eq(hb(rice, { role: 'staple', meal: 'dinner', date: '2026-09-14' }, ctx, { slotItems: [], dayRecipes: () => new Set() }), null, '糙米飯 70 分鐘在平日晚餐不被時間上限擋（主食不算）');
  const slowMain = recipes.find((r) => r.role === 'main' && r.time > 40);
  eq(hb(slowMain, { role: 'main', meal: 'dinner', date: '2026-09-14' }, ctx, { slotItems: [], dayRecipes: () => new Set() }), 'time', `（對照）${slowMain.name} ${slowMain.time} 分鐘在平日晚餐被時間上限擋`);
}

section('鎖定與外食');
const first = gen();
const lockIdx = first.plan.slots.findIndex((s) => s.meal === 'dinner');
const lockedMain = first.plan.slots[lockIdx].items.find((it) => it.role === 'main');
lockedMain.locked = true;
first.plan.slots[3].kind = 'eatOut'; first.plan.slots[3].items = [];
const again = gen({ seed: 'different-seed', prevPlan: first.plan });
eq(again.plan.slots[lockIdx].items.find((it) => it.role === 'main').recipeId, lockedMain.recipeId, '鎖住的主菜重新產生（換 seed）後還是同一道');
ok(again.plan.slots[lockIdx].items.find((it) => it.role === 'main').locked === true, '而且仍然是鎖住的');
eq(again.plan.slots[3].kind, 'eatOut', '外食格保留');
eq(again.plan.slots[3].items, [], '外食格沒有菜');
ok(again.plan.slots.filter((s) => s.kind === 'cook').some((s, i) => JSON.stringify(s.items) !== JSON.stringify(first.plan.slots.filter((x) => x.kind === 'cook')[i]?.items)), '（對照）沒鎖的格子有變（seed 不同）');

section('換一道');
const base = gen();
const si = base.plan.slots.findIndex((s) => s.meal === 'lunch');
const before = base.plan.slots[si].items.find((it) => it.role === 'main').recipeId;
const swapped = swapItem({ plan: base.plan, slotIndex: si, role: 'main', recipes, members: [], idx, units, favorites: [], history: [], shoppingDays: [3, 6], seed: 'test' });
ok(swapped && swapped.recipeId !== before, `換一道之後不是原本那道（${before} → ${swapped?.recipeId}）`);
ok(swapped && byId.get(swapped.recipeId).role === 'main', '換到的還是主菜');
ok(swapped && swapped.reasons.length >= 2, '換到的也有理由');

section('理由是事實，不是建議');
const allReasons = cookSlots(a.plan).flatMap((s) => s.items.flatMap((it) => it.reasons));
ok(allReasons.length >= 100, `（母體）${allReasons.length} 條理由`);
noneOf(allReasons, (t) => /建議|應該|適合|療效|治療|控制|改善|健康的選擇/.test(t), '沒有建議語氣或療效字眼');
ok(allReasons.some((t) => /天內沒出現過/.test(t)), '有「N 天內沒出現過」這種事實');
ok(allReasons.some((t) => /蛋白質來源/.test(t)), '有蛋白質來源');
ok(allReasons.some((t) => /約 \d+ 分鐘/.test(t)), '有時間');
detects((t) => /建議|應該|適合|療效|治療|控制|改善/.test(t), {
  shouldHit: ['建議多吃這道', '適合糖尿病患者', '有助控制血糖', '這道很健康應該常吃'],
  shouldMiss: ['估 鈉 320 mg／份，不高於主菜池子的中位數 450', '14 天內沒出現過', '姊（全素不含五辛）可吃素版', '當季（9 月）'],
}, '「建議語氣」的判準有對照組');

section('一餐 3–5 道：午餐 4、晚餐 5、早餐 1');
{
  const fam3 = [{ ...newMember(), name: '爸' }, { ...newMember(), name: '媽' }, { ...newMember(), name: '弟' }];
  const { plan: cp } = gen({ members: fam3 });
  const countsOf = (meal) => cookSlots(cp).filter((s) => s.meal === meal).map((s) => s.items.length);
  const lunches = countsOf('lunch');
  const dinners = countsOf('dinner');
  const breakfasts = countsOf('breakfast');
  eq([lunches.length, dinners.length, breakfasts.length], [7, 7, 7], '（母體）一週 7 個午餐、7 個晚餐、7 個早餐');
  everyOf(lunches, (n) => n >= 3 && n <= 5, `午餐 3–5 道（實際 ${lunches.join('、')}；主菜本身含主食時會少一道主食）`);
  everyOf(dinners, (n) => n >= 4 && n <= 5, `晚餐 4–5 道（實際 ${dinners.join('、')}）`);
  everyOf(breakfasts, (n) => n === 1, '早餐一道 —— 使用者決定早餐以簡單準備又健康為準，不套用「每餐有葷」');
  const total = cp.slots.reduce((n, s) => n + s.items.length, 0);
  ok(total >= 65, `一週共 ${total} 道（改成一餐 3–5 道之前是 55 道）`);
  // 一餐有兩道配菜，所以每道菜認的是位置：同一格裡不可以有兩道菜佔同一個位置
  everyOf(cookSlots(cp), (s) => new Set(s.items.map((it) => it.pos)).size === s.items.length, '同一格裡每道菜的位置都不一樣');
  everyOf(cookSlots(cp).flatMap((s) => s.items), (it) => Number.isInteger(it.pos), '每道菜都有位置編號（換菜、鎖定、指定靠它）');
  const sideCounts = cookSlots(cp).filter((s) => s.meal !== 'breakfast').map((s) => s.items.filter((it) => it.role === 'side').length);
  everyOf(sideCounts, (n) => n === 2, '每個午晚餐都有兩道配菜');
}

section('每餐都要有葷（午晚餐）');
{
  const fam3 = [{ ...newMember(), name: '爸' }, { ...newMember(), name: '媽' }, { ...newMember(), name: '弟' }];
  const check = (members) => {
    let meaty = 0; let total = 0; const noMeat = [];
    for (const seed of ['a', 'b', 'c', 'd']) {
      const { plan, diagnostics } = gen({ members, seed });
      for (const s of cookSlots(plan)) {
        if (s.meal === 'breakfast') continue;
        total += 1;
        if (s.items.some((it) => isMeaty(byId.get(it.recipeId)))) meaty += 1;
      }
      noMeat.push(...diagnostics.noMeat);
    }
    return { meaty, total, noMeat };
  };
  const omni = check(fam3);
  ok(omni.total === 56, `（母體）四週 ${omni.total} 個午晚餐`);
  eq(omni.meaty, omni.total, `全葷家庭：每一個午晚餐都有葷菜（${omni.meaty}/${omni.total}）`);
  eq(omni.noMeat.length, 0, '沒有任何一餐要靠 diagnostics 說明缺葷菜');
  const mixed = check([{ ...newMember(), name: '爸' }, { ...newMember(), name: '姊', diet: 'veganNoAllium' }]);
  eq(mixed.meaty, mixed.total, `有全素不含五辛的成員時也一樣（${mixed.meaty}/${mixed.total}）—— 靠的是可分流的菜，素食成員吃素版`);
  // 對照組：全家都吃素 → 不需要葷菜，也不可以硬塞 meatOnly
  const vegFam = [{ ...newMember(), name: '姊', diet: 'vegan' }, { ...newMember(), name: '妹', diet: 'veganNoAllium' }];
  const { plan: vpp } = gen({ members: vegFam });
  noneOf(cookSlots(vpp).flatMap((s) => s.items), (it) => byId.get(it.recipeId).vegMode === 'meatOnly', '（對照）全素家庭一道純葷的都沒有');
}

section('素食保障優先於「每餐有葷」');
{
  const fam = [{ ...newMember(), name: '爸' }, { ...newMember(), name: '姊', diet: 'vegan' }];
  // 真實池：每個午晚餐素食成員都吃得到至少 3 道
  const { plan: rp2 } = gen({ members: fam });
  const vegCounts = cookSlots(rp2).filter((s) => s.meal !== 'breakfast')
    .map((s) => s.items.filter((it) => versionFor(byId.get(it.recipeId), 'vegan') !== null).length);
  ok(vegCounts.length === 14, `（母體）${vegCounts.length} 個午晚餐`);
  everyOf(vegCounts, (n) => n >= VEG_MIN_DISHES, `每個午晚餐全素成員都吃得到 ≥ ${VEG_MIN_DISHES} 道（實際最少 ${Math.min(...vegCounts)} 道）`);

  // 合成池：沒有任何「可分流」的主菜 → 葷菜只能當加菜，而且素食保障要先成立
  const vegMains = recipes.filter((r) => r.role === 'main' && r.vegMode === 'nativeVeg').slice(0, 8);
  const meatMains = recipes.filter((r) => r.role === 'main' && r.vegMode === 'meatOnly').slice(0, 8);
  const others = recipes.filter((r) => r.role !== 'main');
  const noSplit = [...vegMains, ...meatMains, ...others];
  const { plan: xp, diagnostics: xd } = gen({ members: fam, recipes: noSplit });
  const extras = cookSlots(xp).flatMap((s) => s.items.filter((it) => it.extraMeat));
  ok(extras.length >= 10, `（母體）沒有可分流主菜時，出現 ${extras.length} 道「僅葷食成員」的加菜`);
  everyOf(extras, (it) => byId.get(it.recipeId).vegMode === 'meatOnly', '加菜都是純葷的菜');
  everyOf(extras, (it) => it.reasons.some((t) => t.includes('加菜')), '加菜的理由講明它是加菜');
  const xVeg = cookSlots(xp).filter((s) => s.meal !== 'breakfast')
    .map((s) => s.items.filter((it) => versionFor(byId.get(it.recipeId), 'vegan') !== null).length);
  everyOf(xVeg, (n) => n >= VEG_MIN_DISHES, `加了葷加菜之後，全素成員每餐仍吃得到 ≥ ${VEG_MIN_DISHES} 道（實際最少 ${Math.min(...xVeg)} 道）`);
  void xd;

  // 再收緊：連素的主菜都沒有 → 主菜整格排不出來。這時「放不放加菜」剛好在午餐與晚餐給出不同答案，
  // 因為素食保障算的是**這一餐**還剩幾道吃得到的：午餐只剩配菜與主食，晚餐多一道湯。
  const onlyMeatMains = [...meatMains, ...others];
  const { plan: yp, diagnostics: yd } = gen({ members: fam, recipes: onlyMeatMains });
  const yLunch = cookSlots(yp).filter((s) => s.meal === 'lunch');
  const yDinner = cookSlots(yp).filter((s) => s.meal === 'dinner');
  ok(yLunch.length === 7 && yDinner.length === 7, '（母體）七個午餐、七個晚餐');
  eq(yLunch.flatMap((s) => s.items.filter((it) => it.extraMeat)).length, 0,
    '午餐不放加菜 —— 主菜排不出來時再放一道葷的，全素成員只剩兩道');
  eq(yd.noMeat.filter((x) => x.meal === 'lunch').length, 7, '七個午餐都記進 diagnostics.noMeat（本週頁會明講）');
  everyOf(yd.noMeat, (x) => x.why.includes('素食成員'), '理由寫的是「要先確保素食成員吃得到」');
  const dinnerExtras = yDinner.flatMap((s) => s.items.filter((it) => it.extraMeat));
  ok(dinnerExtras.length >= 5, `晚餐放得下加菜（${dinnerExtras.length} 餐）—— 還有湯與主食，全素成員仍有三道`);
  everyOf(yDinner, (s) => s.items.filter((it) => versionFor(byId.get(it.recipeId), 'vegan') !== null).length >= VEG_MIN_DISHES,
    `而且那幾個晚餐全素成員確實吃得到 ≥ ${VEG_MIN_DISHES} 道`);
}

section('避開開關：使用者自己開才排除');
{
  // 池子裡沒有含精緻糖的菜，所以合成一道：把一道主菜的 tags 加上 sweet
  const sweetMain = { ...byId.get('r-onion-egg'), id: 'r-test-sweet', name: '測試甜主菜', tags: [...byId.get('r-onion-egg').tags, 'sweet'], vegTags: [...(byId.get('r-onion-egg').vegTags ?? []), 'sweet'] };
  const onlySweet = [...recipes.filter((r) => r.role !== 'main'), sweetMain];
  const off = gen({ recipes: onlySweet, rules: { avoid: { sweet: false } } });
  const on = gen({ recipes: onlySweet, rules: { avoid: { sweet: true } } });
  eq(mainsOf(off.plan).length, 14, '「避開精緻糖」關著：那道甜主菜照排（14 個午晚餐都有主菜）');
  eq(mainsOf(on.plan).length, 0, '開了「避開精緻糖」：唯一的主菜被排除，14 個午晚餐都沒有主菜');
  eq(on.diagnostics.empty.filter((e) => e.role === 'main').length, 14, '而且 diagnostics.empty 記了 14 筆（明講，不是靜默）');
  // 對照：留意項目本身不排除 —— 同一道甜主菜，糖尿病成員但沒開開關 → 照排
  const watchOnly = gen({ recipes: onlySweet, members: [diabetic] });
  eq(mainsOf(watchOnly.plan).length, 14, '（對照）有糖尿病成員但沒開開關：留意項目只降分，甜主菜照排');
}

section('購物清單勾了「家裡有」→ 用到那個食材的菜加分');
{
  const CABBAGE = 'E30001';
  const state = { slotItems: [], placedWant: new Set(), lastServed: () => null, timesServedWithin: () => 0, dayProteins: () => new Set(), prevDayMealProteins: () => new Set(), fishCount: () => 0, rangeHas: () => false };
  const slot = { role: 'side', meal: 'dinner', date: '2026-09-14', day: 0 };
  const withHave = buildContext({ recipes, members: [], idx, units, shoppingDays: [], haveFoods: new Set([CABBAGE]) });
  const without = buildContext({ recipes, members: [], idx, units, shoppingDays: [] });
  const cabbageSide = byId.get('r-stir-fried-cabbage');
  const otherSide = byId.get('r-blanched-okra');
  const sHave = scoreSoft(cabbageSide, slot, withHave, state, () => 0); const sNone = scoreSoft(cabbageSide, slot, without, state, () => 0);
  ok(sHave.score > sNone.score, `家裡有高麗菜：清炒高麗菜 ${sHave.score.toFixed(1)} > 沒勾時 ${sNone.score.toFixed(1)}`);
  ok(sHave.reasons.some((t) => t.includes('你勾了家裡有')), `理由：${sHave.reasons.find((t) => t.includes('家裡有'))}`);
  eq(scoreSoft(otherSide, slot, withHave, state, () => 0).score, scoreSoft(otherSide, slot, without, state, () => 0).score, '（對照）沒用到高麗菜的菜分數不變');
}

section('家裡有人留意醣 → 主食「優先」排全穀雜糧（是加分，不是規定）');
{
  // 舊版斷言是「主食全部都是全穀」。那在只有 5 道主食的池子裡是巧合：食譜補到 172 道之後，
  // 當季的芋頭飯、麵條也會被排進來，斷言就紅了 —— 但規劃器並沒有壞。
  // PLAN §4.1 寫的是「優先排糙米／雜糧飯」，優先＝加分。加分做得到什麼，要用**比例**量，
  // 而且要有對照組：沒有人留意醣的同一個家庭，比例應該明顯低很多。
  const share = (members) => {
    let whole = 0; let total = 0; const names = new Set();
    for (const seed of ['test', 's2', 's3', 's4']) {
      const { plan } = gen({ members, seed });
      for (const s of cookSlots(plan)) {
        for (const it of s.items.filter((x) => x.role === 'staple')) {
          const r = byId.get(it.recipeId);
          total += 1; names.add(r.name);
          if (r.tags.includes('wholegrain')) whole += 1;
        }
      }
    }
    return { whole, total, pct: whole / total, names: [...names] };
  };
  const watch = share([{ ...newMember(), name: '爸' }, { ...newMember(), name: '阿嬤', diet: 'lactoOvo', conditions: ['diabetes'] }]);
  const plain = share([{ ...newMember(), name: '爸' }, { ...newMember(), name: '媽' }]);
  ok(watch.total >= 40 && plain.total >= 40, `（母體）四週各排了 ${watch.total}／${plain.total} 個主食格`);
  ok(watch.pct >= 0.7, `有人留意醣：全穀主食 ${watch.whole}/${watch.total}（${Math.round(watch.pct * 100)}%）`);
  ok(plain.pct <= 0.5, `（對照）沒有人留意醣的同一個家庭只有 ${plain.whole}/${plain.total}（${Math.round(plain.pct * 100)}%）—— 差別是那個加分做出來的`);
  ok(watch.pct - plain.pct >= 0.3, `兩者差 ${Math.round((watch.pct - plain.pct) * 100)} 個百分點`);
  ok(watch.names.length >= 2, `而且不是只排同一種：${watch.names.join('、')}`);
}

section('舊版計畫沒有位置欄位 → 讀出來時補上（相容轉換）');
{
  // v0.6.0 以前一餐一個角色只有一道菜，item 沒有 pos。使用者升級之後那一週的計畫還在 IndexedDB 裡，
  // 補不上位置的話，本週頁會找不到菜（用 pos 找）、換菜也會換錯道。
  const old = {
    weekKey: '2026-W38', monday: MONDAY, seed: 'old',
    slots: [
      { day: 0, date: MONDAY, meal: 'lunch', kind: 'cook', items: [
        { recipeId: 'r-stir-fried-cabbage', role: 'side', locked: false, reasons: ['舊的'] },
        { recipeId: 'r-white-rice', role: 'staple', locked: false, reasons: ['舊的'] },
        { recipeId: 'r-cabbage-pork-stirfry', role: 'main', locked: true, reasons: ['舊的'] },
      ] },
      { day: 0, date: MONDAY, meal: 'breakfast', kind: 'eatOut', items: [] },
    ],
  };
  const migrated = withPositions(JSON.parse(JSON.stringify(old)));
  const lunch = migrated.slots.find((x) => x.meal === 'lunch');
  eq(lunch.items.map((it) => it.pos), [0, 1, 3], '主菜補到位置 0、配菜補到位置 1、主食補到位置 3（午餐是 main／side／side／staple）');
  eq(lunch.items.map((it) => it.role), ['main', 'side', 'staple'], '而且照位置排好（原本主菜排在最後）');
  everyOf(lunch.items, (it) => Number.isInteger(it.pos), '每一道都有位置');
  eq(lunch.items.find((it) => it.role === 'main').locked, true, '鎖定狀態沒有被弄丟');
  eq(migrated.slots.find((x) => x.meal === 'breakfast').items, [], '外食那一格沒有菜，也不會出事');
  // 已經有 pos 的計畫不可以被動到
  const fresh = { slots: [{ meal: 'lunch', kind: 'cook', items: [{ recipeId: 'r-white-rice', role: 'staple', pos: 3 }] }] };
  eq(withPositions(JSON.parse(JSON.stringify(fresh))).slots[0].items[0].pos, 3, '已經有位置的計畫維持原樣');
  eq(withPositions(null), null, '沒有計畫也不會炸');
}

section('每日估計：素食成員吃素版');
{
  const split = byId.get('r-cabbage-pork-stirfry');
  const slots = [{ day: 0, date: '2026-09-14', meal: 'dinner', kind: 'cook', items: [{ recipeId: split.id, role: 'main' }] }];
  const rows = dailyEstimates(slots, [{ ...newMember(), name: '爸', diet: 'omni' }, { ...newMember(), name: '姊', diet: 'vegan' }], idx, byId, ['kcal', 'protein']);
  const dad = rows.find((r) => r.label === '爸'); const sis = rows.find((r) => r.label === '姊');
  ok(sis.fields.protein < dad.fields.protein, `同一道可分流的菜：全素的姊算素版（蛋白質 ${sis.fields.protein.toFixed(1)}）、爸算葷版（${dad.fields.protein.toFixed(1)}），不一樣`);
  const meatOnly = byId.get('r-steamed-fish');
  const rows2 = dailyEstimates([{ ...slots[0], items: [{ recipeId: meatOnly.id, role: 'main' }] }], [{ ...newMember(), name: '姊', diet: 'vegan' }], idx, byId, ['kcal']);
  eq(rows2[0].missing, 1, '吃不了的菜記在 missing，不是把葷版算給素食成員');
  eq(rows2[0].fields.kcal, null, '而且那一天沒有東西可算 → null，不是 0');
}

section('每日估計');
const dayRows = dailyEstimates(a.plan.slots.filter((s) => s.day === 0), fam, idx, byId, ['kcal', 'carb', 'sodium']);
eq(dayRows.length, 3, '三位家人各一列');
everyOf(dayRows, (row) => row.fields.kcal > 0 && row.fields.carb > 0, '每位都有加總（這一天的菜每位都吃得了）');
ok(dayRows.find((r) => r.label === '姊').fields.kcal <= dayRows.find((r) => r.label === '爸').fields.kcal, '全素成員吃素版，熱量不高於吃葷版的爸（同一天同幾道菜）');
const empty = dailyEstimates([], [], idx, byId, ['kcal']);
eq(empty, [{ label: '每人一份', diet: 'omni', fields: { kcal: null }, missing: 0 }], '沒有菜 → null 不是 0');

section('放寬的理由要照「實際擋住的那一條」寫，不是照「開了哪些旗標」');
// 背景：pickForSlot 的放寬是累加的（第 4 次嘗試同時開烹法、時間、保存期限）。
// 舊版拿 Object.keys(relax) 當理由來源，所以只是因為保存期限才放寬的菜，
// 會被一起貼上「超過這一餐的時間上限」—— 使用者看到一個不存在的原因。
{
  const CAPS = { weekday: { breakfast: 20, lunch: 35, dinner: 40 }, weekend: { breakfast: 40, lunch: 60, dinner: 60 } };
  const fam = [
    { ...newMember(), id: 'm1', name: '媽' },
    { ...newMember(), id: 'm2', name: '姊', diet: 'veganNoAllium' },
    { ...newMember(), id: 'm3', name: '嬤' },
  ];
  // 一週只買一次菜 → 保存期限吃緊，正是舊版會亂貼理由的情境
  const tight = gen({ members: fam, shoppingDays: [3], seed: 'a' });
  const tightCtx = buildContext({ recipes, members: fam, idx, units, shoppingDays: [3] });
  const timeClaims = [];
  for (const s of cookSlots(tight.plan)) {
    const cap = CAPS[[0, 6].includes(new Date(`${s.date}T00:00:00`).getDay()) ? 'weekend' : 'weekday'][s.meal];
    for (const it of s.items) {
      const r = byId.get(it.recipeId);
      for (const line of it.reasons ?? []) if (line.includes('超過這一餐的')) timeClaims.push({ name: r.name, time: r.time, cap });
    }
  }
  ok(timeClaims.length >= 1, `（母體）這週有 ${timeClaims.length} 句「超過這一餐的時間上限」：${timeClaims.map((c) => `${c.name} ${c.time}/${c.cap}`).join('、')}`);
  everyOf(timeClaims, (c) => c.time > c.cap, '每一句「超過時間上限」的菜，時間**真的**超過那一餐的上限');

  // 對照：保存期限的理由也要指到真的撐不到的那個食材
  const shelfClaims = [];
  for (const s of cookSlots(tight.plan)) {
    for (const it of s.items) {
      for (const line of it.reasons ?? []) {
        if (!line.includes('不耐放') && !line.includes('要先冷凍')) continue;
        shelfClaims.push({ line, blocker: shelfBlocker(byId.get(it.recipeId), s.date, tightCtx) });
      }
    }
  }
  ok(shelfClaims.length >= 1, `（母體）這週有 ${shelfClaims.length} 句保存期限的理由`);
  everyOf(shelfClaims, (c) => c.blocker !== null, '每一句保存期限的理由，這道菜在那一天**真的**有食材撐不到');
  everyOf(shelfClaims, (c) => c.line.includes(c.blocker.label), '而且句子裡講的食材就是實際擋住的那一個');

  // 冷凍那句只對肉魚講：叫人把九層塔、青江菜冷凍是錯的
  everyOf(shelfClaims, (c) => (c.line.includes('要先冷凍') ? FREEZABLE_CATS.has(c.blocker.cat) : true), '「要先冷凍」只出現在肉類與魚貝類');
  everyOf(shelfClaims, (c) => (FREEZABLE_CATS.has(c.blocker.cat) ? c.line.includes('要先冷凍') : c.line.includes('不耐放')), '蔬菜、辛香料那些講的是「不耐放」，不是叫人冷凍');
}

section('actualRelaxations：逐條探測，回的是實際踩到的那一條');
{
  const ctx = buildContext({ recipes, members: [], idx, units, shoppingDays: [3] });
  const stub = { slotItems: [], dayRecipes: () => new Set() };
  const slow = recipes.find((r) => r.role === 'main' && r.time > 40 && !r.ingredients.some((i) => !i.pantry));
  const slowAny = slow ?? recipes.find((r) => r.role === 'main' && r.time > 40);
  const info = { role: 'main', meal: 'dinner', date: '2026-09-17' }; // 買菜日隔天：保存期限鬆
  eq(actualRelaxations(slowAny, info, ctx, stub), ['relaxTime'], `${slowAny.name} ${slowAny.time} 分鐘、離買菜日 1 天 → 只踩到時間`);
  const quick = recipes.find((r) => r.role === 'main' && r.time <= 20 && shelfBlocker(r, '2026-09-20', ctx));
  ok(quick, `（前提）找得到一道快、但食材撐不到週日的主菜：${quick?.name}`);
  eq(actualRelaxations(quick, { role: 'main', meal: 'dinner', date: '2026-09-20' }, ctx, stub), ['relaxShelf'],
    `${quick.name} 只有 ${quick.time} 分鐘 → 只踩到保存期限，**不會**被講成超過時間上限`);
  eq(actualRelaxations(quick, { role: 'main', meal: 'dinner', date: '2026-09-17' }, ctx, stub), [], '（對照）同一道菜排在買菜日隔天 → 一條都沒踩到');
  const soup = recipes.find((r) => r.role === 'soup' && r.method === 'soup' && r.time <= 30);
  eq(actualRelaxations(soup, { role: 'soup', meal: 'dinner', date: '2026-09-17' }, ctx,
    { slotItems: [{ recipeId: 'x', role: 'main', method: 'soup' }], dayRecipes: () => new Set() }), ['relaxMethod'],
  '同一餐已經有一道湯 → 只踩到烹法');
  eq(actualRelaxations(soup, { role: 'soup', meal: 'dinner', date: '2026-09-17' }, ctx,
    { slotItems: [], dayRecipes: (d) => new Set(d === '2026-09-17' ? [soup.id] : []) }), ['relaxDay'],
  '今天另一餐排過這道 → 只踩到同一天重複');
}

section('diagnostics.relaxed：一道菜一筆，記的是實際原因');
{
  const fam = [{ ...newMember(), id: 'm1', name: '媽' }, { ...newMember(), id: 'm2', name: '姊', diet: 'veganNoAllium' }];
  const { plan, diagnostics } = gen({ members: fam, shoppingDays: [3], seed: 'a' });
  const keys = diagnostics.relaxed.map((r) => `${r.date}|${r.meal}|${r.pos}`);
  eq(keys.length, new Set(keys).size, `${keys.length} 筆 relaxed 全部是不同的位置（一道菜一筆，不是一個旗標一筆）`);
  ok(diagnostics.relaxed.length >= 1, `（母體）這週有 ${diagnostics.relaxed.length} 道被放寬`);
  everyOf(diagnostics.relaxed, (r) => Array.isArray(r.constraints) && r.constraints.length >= 1, '每一筆都帶著實際踩到的限制清單');
  everyOf(diagnostics.relaxed, (r) => r.constraints.every((c) => RELAXABLE.includes(c)), '清單裡的每一條都是可放寬的四條之一');
  everyOf(diagnostics.relaxed, (r) => plan.slots.some((s) => s.date === r.date && s.meal === r.meal && s.items.some((it) => it.pos === r.pos && it.recipeId === r.recipeId)),
    '每一筆都指得到計畫裡真的存在的那道菜');
  // 多一個買菜日就解得掉保存期限的壓力 —— 診斷卡的建議就是根據這件事
  const loose = gen({ members: fam, shoppingDays: [3, 6], seed: 'a' });
  const shelfTight = diagnostics.relaxed.filter((r) => r.constraints.includes('relaxShelf')).length;
  const shelfLoose = loose.diagnostics.relaxed.filter((r) => r.constraints.includes('relaxShelf')).length;
  ok(shelfTight > shelfLoose, `一週買一次菜有 ${shelfTight} 道卡在保存期限，買兩次剩 ${shelfLoose} 道（診斷卡建議多勾一天就是根據這個）`);
}

section('保存天數：一個食材的所有口語詞都要拿去對 overrides');
{
  const ctx = buildContext({ recipes, members: [], idx, units, shoppingDays: [3] });
  const ov = units.shelfDays.overrides;
  const terms = Object.keys(ov).filter((t) => idx.aliasMap.get(t));
  ok(terms.length >= 50, `（母體）overrides 有 ${terms.length} 條查得到編號`);
  everyOf(terms, (t) => {
    const id = idx.aliasMap.get(t);
    const food = idx.byId.get(id);
    return shelfDaysFor({ aliases: ctx.aliasesById.get(id) ?? [], cat: food.cat }, units) <= ov[t];
  }, 'overrides 上的每一條都拿得到（不會因為別名表先收了「老薑」就落回蔬菜類的 3 天）');
  const gingerId = idx.aliasMap.get('薑');
  eq(shelfDaysFor({ aliases: ctx.aliasesById.get(gingerId) ?? [], cat: idx.byId.get(gingerId).cat }, units), ov['薑'],
    `薑拿到 override 的 ${ov['薑']} 天（別名表第一個收的是「老薑」）`);
  eq(shelfDaysFor({ alias: '老薑', cat: '蔬菜類' }, units), units.shelfDays.byCategory['蔬菜類'], '（對照）只給「老薑」一個詞的話就是落回蔬菜類');
}

section('早餐不排連續兩天一樣');
// 使用者實際用過之後回報的。早餐**不納入**「幾天內不重複」（池子小、隔幾天再吃一次沒關係），
// 但連著兩天一模一樣是另一回事。
{
  const fams = {
    '全葷 3 人': [{ ...newMember(), name: 'a' }, { ...newMember(), name: 'b' }, { ...newMember(), name: 'c' }],
    '含全素不含五辛': [{ ...newMember(), name: 'a' }, { ...newMember(), name: 'b', diet: 'veganNoAllium' }],
    '全家全素': [{ ...newMember(), name: 'a', diet: 'vegan' }],
  };
  const runs = [];
  for (const [label, members] of Object.entries(fams)) {
    const pool = recipes.filter((r) => r.role === 'breakfast' && members.every((m) => versionFor(r, m.diet) !== null));
    for (const seed of ['a', 'b', 'c', 'd']) {
      for (const monday of ['2026-09-14', '2026-10-05']) {
        const { plan: p2, diagnostics } = gen({ members, seed, mondayIso: monday });
        const seq = p2.slots.filter((x) => x.meal === 'breakfast' && x.kind === 'cook').sort((a, b) => a.day - b.day).map((x) => x.items[0]?.recipeId ?? null);
        let rep2 = 0;
        for (let i = 1; i < seq.length; i += 1) if (seq[i] && seq[i] === seq[i - 1]) rep2 += 1;
        runs.push({ label, poolSize: pool.length, seq, repeats: rep2, relaxed: diagnostics.relaxed.filter((r) => r.constraints.includes('relaxBreakfast')).length });
      }
    }
  }
  ok(runs.length === 24, `（母體）三種家庭 × 4 個 seed × 2 個起始週 ＝ ${runs.length} 週`);
  everyOf(runs, (r) => r.seq.filter(Boolean).length === 7, '每一週都排得出 7 天的早餐');
  everyOf(runs, (r) => r.repeats === 0, `沒有任何一週出現連續兩天同一道早餐（最嚴格的全素家庭吃得到 ${runs.find((r) => r.label === '全家全素').poolSize} 道）`);
  everyOf(runs, (r) => r.relaxed === 0, '而且都不需要放寬這條（池子夠）');
  // 對照：這條約束真的有在擋 —— 沒有它的話，同一組 seed 會排出連續重複
  const { hardBlock: hb2, buildContext: bc2 } = { hardBlock, buildContext };
  const ctxB = bc2({ recipes, members: [], idx, units, shoppingDays: [] });
  const bf = recipes.find((r) => r.role === 'breakfast');
  const stateYesterday = { slotItems: [], dayRecipes: () => new Set(), lastServed: () => 1 };
  const stateLongAgo = { slotItems: [], dayRecipes: () => new Set(), lastServed: () => 5 };
  eq(hb2(bf, { role: 'breakfast', meal: 'breakfast', date: '2026-09-15' }, ctxB, stateYesterday), 'breakfastRepeat', '昨天排過的早餐今天被擋下來');
  eq(hb2(bf, { role: 'breakfast', meal: 'breakfast', date: '2026-09-15' }, ctxB, stateLongAgo), null, '（對照）5 天前排過的早餐照樣可以排（早餐不吃「不重複」那一套）');
  eq(hb2(bf, { role: 'breakfast', meal: 'breakfast', date: '2026-09-15' }, ctxB, stateYesterday, { relaxBreakfast: true }), null, '真的沒得選時放寬得掉');
  const side = recipes.find((r) => r.role === 'side');
  eq(hb2(side, { role: 'side', meal: 'dinner', date: '2026-09-15' }, ctxB, stateYesterday), null, '（對照）這條只管早餐，配菜昨天排過照樣可以排');
}

section('早餐池太小的時候：誠實放寬，不是硬排也不是報錯');
{
  const one = recipes.filter((r) => r.role === 'breakfast').slice(0, 1);
  const two = recipes.filter((r) => r.role === 'breakfast').slice(0, 2);
  const poolOf = (bs) => [...recipes.filter((r) => r.role !== 'breakfast'), ...bs];
  const runTiny = (bs) => {
    const { plan: p2, diagnostics } = generateWeek({ recipes: poolOf(bs), members: [{ ...newMember(), name: 'a' }], idx, units, favorites: [], history: [], mondayIso: MONDAY, seed: 'tiny', shoppingDays: [3, 6] });
    const seq = p2.slots.filter((x) => x.meal === 'breakfast' && x.kind === 'cook').sort((a, b) => a.day - b.day).map((x) => x.items[0]?.recipeId ?? null);
    let rep2 = 0;
    for (let i = 1; i < seq.length; i += 1) if (seq[i] && seq[i] === seq[i - 1]) rep2 += 1;
    return { seq, repeats: rep2, relaxed: diagnostics.relaxed.filter((r) => r.constraints.includes('relaxBreakfast')).length, empty: diagnostics.empty.filter((e) => e.role === 'breakfast').length };
  };
  const t2 = runTiny(two);
  eq(t2.repeats, 0, '只有 2 道早餐時，一三五／二四六交替就好，不會連兩天一樣');
  eq(t2.relaxed, 0, '也不需要放寬');
  const t1 = runTiny(one);
  eq(t1.seq.filter(Boolean).length, 7, '只有 1 道早餐時，7 天照樣排得滿（不會留空格）');
  ok(t1.repeats >= 1, `只有 1 道就一定會重複（${t1.repeats} 次）—— 這是事實，不是 bug`);
  eq(t1.relaxed, t1.repeats, `而且每一次都記進 diagnostics 明講（${t1.relaxed} 筆），不是靜默硬排`);
  eq(t1.empty, 0, '也不是丟一個排不出來的空格給使用者');
}

section('「家裡有」要一路傳到排菜器（少接一個參數就靜默失效）');
// 實際踩過：generateWeek 沒有收 haveFoods，本週頁傳進來的那一包被丟掉，
// 「勾了家裡有的菜會加分」在 App 裡從來沒生效過。scoreSoft 是對的，
// 但沒有人驗「從 generateWeek 進去」這條路。
{
  const cabbage = idx.aliasMap.get('高麗菜');
  const carrot = idx.aliasMap.get('胡蘿蔔');
  ok(cabbage && carrot, '（前提）查得到高麗菜與胡蘿蔔的編號');
  const have = new Set([cabbage, carrot, idx.aliasMap.get('洋蔥'), idx.aliasMap.get('雞蛋')].filter(Boolean));

  const withHave = gen({ seed: 'have', haveFoods: have });
  const without = gen({ seed: 'have' });
  const reasonsOf = (r) => cookSlots(r.plan).flatMap((s) => s.items).flatMap((it) => it.reasons ?? []);
  const hit = reasonsOf(withHave).filter((x) => x.includes('你勾了家裡有'));
  ok(hit.length >= 1, `傳了 haveFoods → ${hit.length} 道菜的理由講出「你勾了家裡有」`);
  eq(reasonsOf(without).filter((x) => x.includes('你勾了家裡有')).length, 0, '（對照）沒傳就一句都沒有');
  everyOf(hit.slice(0, 8), (x) => ['高麗菜', '胡蘿蔔', '紅蘿蔔', '洋蔥', '雞蛋', '蛋'].some((f) => x.includes(f)),
    '講出來的食材就是我勾的那幾樣');

  // 換一道也要走同一套
  const si = withHave.plan.slots.findIndex((s) => s.kind === 'cook' && s.items.some((it) => it.role === 'side'));
  const pos = withHave.plan.slots[si].items.find((it) => it.role === 'side').pos;
  const swapped = swapItem({ plan: withHave.plan, slotIndex: si, pos, recipes, members: [], idx, units, favorites: [], history: [], shoppingDays: [3, 6], seed: 'have', haveFoods: have });
  ok(swapped, '（前提）換得出一道');
  const swappedPlain = swapItem({ plan: without.plan, slotIndex: si, pos, recipes, members: [], idx, units, favorites: [], history: [], shoppingDays: [3, 6], seed: 'have' });
  ok(swappedPlain, '（前提）沒傳 haveFoods 也換得出一道');
  // 換一道拿到的那道菜，如果用到勾過的食材，理由裡就要講出來
  const usedHave = (swapped.reasons ?? []).some((x) => x.includes('你勾了家裡有'));
  const r2 = byId.get(swapped.recipeId);
  const actuallyUses = r2.ingredients.some((ing) => !ing.pantry && have.has(ing.food));
  eq(usedHave, actuallyUses, `換一道也考慮「家裡有」：${r2.name} ${actuallyUses ? '用到了、理由有講' : '沒用到、理由也沒講'}`);
}

section('保存天數要蓋得過買菜日之間的間隔（不然離買菜日最遠那天沒葷菜可挑）');
// 為什麼不是用「每餐都有葷」來守這件事：那條現在守不住了。
// M5 把食譜從 90 道加到 180 道之後，就算把肉類保存天數砍到 2 天、
// 週二有 43/57 道葷主菜被擋掉，剩下的 14 道還是夠填滿 56 個午晚餐 ——
// 「每餐都有葷」照樣全綠，突變不紅。當初那個 bug 是「池子小到只剩兩道」才浮出來的。
//
// 真正要守的是 units.json 的 note 講的那件事：**保存天數要蓋得過買菜日之間的最大間隔**，
// 不然那一天能挑的葷菜會塌掉（就算還排得出來，也會每週重複同幾道）。
// 所以量的是「那一天挑得到幾道」，不是「有沒有排到」。
{
  const SHOP = [3, 6];          // 週三、週六：離買菜日最遠是 3 天
  const ctxS = buildContext({ recipes, members: [], idx, units, shoppingDays: SHOP });
  const stub = { slotItems: [], dayRecipes: () => new Set(), lastServed: () => null };
  const meatMains = recipes.filter((r) => r.role === 'main' && isMeaty(r));
  ok(meatMains.length >= 40, `（母體）${meatMains.length} 道葷主菜`);

  const availableOn = (date) => meatMains.filter((r) => shelfBlocker(r, date, ctxS) === null).length;
  const TUE = '2026-09-15';     // 離上一個買菜日（上週六）3 天 —— 最遠
  const WED = '2026-09-16';     // 買菜日當天 —— 最近
  const gap = daysBetween(lastShoppingDayOnOrBefore(TUE, SHOP), TUE);
  eq(gap, 3, '（前提）買菜日設週三＋週六時，週二離上一次買菜 3 天，是最遠的一天');

  const far = availableOn(TUE);
  const near = availableOn(WED);
  ok(near >= meatMains.length - 2, `（對照）買菜日當天幾乎每道葷主菜都挑得到（${near}/${meatMains.length}）`);
  ok(far >= meatMains.length / 2,
    `離買菜日最遠那天仍然挑得到一半以上的葷主菜（${far}/${meatMains.length}）——` +
    `肉類保存天數（${units.shelfDays.byCategory['肉類']} 天）蓋得過 ${gap} 天的間隔`);
  ok(units.shelfDays.byCategory['肉類'] > gap,
    `肉類 ${units.shelfDays.byCategory['肉類']} 天 > 最大間隔 ${gap} 天（等於的話當天就卡在邊界上）`);
}

done('plannertest');

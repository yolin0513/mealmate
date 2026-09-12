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
  lastShoppingDayOnOrBefore, historyRowsOf, dailyEstimates, medianOf, MEALS,
} from '../js/planner.js';

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
const { versionFor } = await import('../js/members.js');
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

done('plannertest');

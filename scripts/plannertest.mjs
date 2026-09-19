// 週計畫規劃器（npm run plannertest）。純函式，用真的 90 道食譜與合成池。
//
// 守的事（每條都對應一條突變）：
//   · 同種子同輸入 → 同輸出
//   · 主菜池 ≥ 40：4 週主菜 14 天內不重複；池子縮到 10 道 → diagnostics.forcedRepeats 非空
//   · 早餐不吃不重複扣分（同一道可以週一、週三重複）
//   · 慢性病只降分：池子只剩高醣主菜時，糖尿病家庭仍排得出主菜，理由講事實
//   · 腎臟病沒勾「鉀」時，鉀不影響分數
//   · 有素食成員：除了標記 extraMeat 的加菜，每格的每道菜都是每位素食成員吃得了的版本
//   · 混合家庭（有葷有素）每個午晚餐在素食保障成立下放一道純葷加菜（SPEC_排菜葷素比例）
//   · 保存期限：葉菜不會排在買菜日後第 4 天以上
//   · 鎖住的格子重新產生後不變；外食格沒有菜
//   · 理由只有事實，沒有建議語氣

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ok, eq, section, done, everyOf, noneOf, detects } from './tap.mjs';
import { indexFoods } from '../js/foods.js';
import { newMember } from '../js/members.js';
import { shelfOverdue } from '../js/planner.js';
import {
  generateWeek, plainReasons, buildContext, scoreSoft, hardBlock, makeRng, hashSeed, weekKeyOf, mondayOf, addDays,
  lastShoppingDayOnOrBefore, historyRowsOf, dailyEstimates, medianOf, MEALS, isMeaty, VEG_MIN_DISHES, withPositions,
  actualRelaxations, shelfBlocker, RELAXABLE, FREEZABLE_CATS, daysBetween, MEAL_ROLES, refillSlot,
  weekBalance, balanceSentence, assignItem, HEARTY_LEVELS, WEEK_CAPS, BALANCE_NOTE, HEARTY_HINT, HEARTY_TOP_SHARE, groupEstimates,
  riceKindOf, riceKindOfFood, RICE_KINDS, RICE_KIND_LABELS, RICE_KIND_HINT, DEFAULT_RULES, wantMissReason,
  starFoods, STAR_PENALTY, STAR_WINDOW_DAYS, historyRowsOf as rowsOf,
  isProteinDish, proteinDishFor, vegProteinMisses, VEG_PROTEIN_BONUS, VEG_PROTEIN_EARLY_BONUS,
} from '../js/planner.js';
import { displayNameOf } from '../js/foods.js';
import { versionFor as vFor } from '../js/members.js';
import { FORBIDDEN } from './copyrules.mjs';
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
const RICE_RED_WORDS = ['健康', '降', '控制', '療效', '治療', '建議', '應該', '比較好'];
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
// 2026-09-16 SPEC_排菜葷素比例：混合家庭每個午晚餐在素食保障成立下會放一道純葷加菜，
// 所以「零 meatOnly」不再是對的語意。改成三件事：沒標加菜的每一道素食成員都吃得了、標加菜的都是純葷主菜、一餐最多一道。
const vRows = cookSlots(vp).flatMap((s) => s.items.map((it) => ({ it, r: byId.get(it.recipeId), meal: s.meal })));
const vPlain = vRows.filter((x) => !x.it.extraMeat);
const vExtras = vRows.filter((x) => x.it.extraMeat);
ok(vPlain.length >= 40, `（母體）不含加菜的 ${vPlain.length} 道`);
everyOf(vPlain.map((x) => x.r), (r) => versionFor(r, 'lactoOvo') !== null && versionFor(r, 'veganNoAllium') !== null,
  '除了加菜，每一道菜蛋奶素與全素（不吃五辛）的成員都吃得了');
ok(vExtras.length >= 10, `（母體）這一週有 ${vExtras.length} 道加菜`);
everyOf(vExtras, (x) => x.r.vegMode === 'meatOnly' && x.it.role === 'main', '標了加菜的都是純葷主菜');
everyOf(cookSlots(vp).filter((s) => s.meal !== 'breakfast'), (s) => s.items.filter((it) => it.extraMeat).length <= 1, '一餐最多一道加菜');
ok(vItems.some((r) => r.vegMode === 'splittable'), '（對照）有可分流的菜（葷食成員吃葷版），不是全變成素菜');
ok(cookSlots(vp).flatMap((s) => s.items).some((it) => it.reasons.some((t) => t.includes('姊（全素）可吃'))), '理由寫出「姊（全素）可吃」');
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
  // 2026-09-18 起主食的米照設定排；這條驗的是時間上限，所以設成糙米
  const brownCtx = bc({ recipes, members: [], idx, units, shoppingDays: [], rules: { riceKind: 'brown' } });
  eq(hb(rice, { role: 'staple', meal: 'dinner', date: '2026-09-14' }, brownCtx, { slotItems: [], dayRecipes: () => new Set() }), null, '糙米飯 70 分鐘在平日晚餐不被時間上限擋（主食不算）');
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

section('菜色選項卡上的理由：帶估算數字的一句都不印（plainReasons）');
{
  // 2026-09-18 使用者回報：家裡設高血壓＋糖尿病後，每道菜的選單卡多出四行「估 鈉…中位數…」，一般人看不懂。
  // 留意欄位照樣影響排序（scoreSoft 沒動），只是那幾句不印在卡上。
  const sample = [
    '14 天內沒出現過',
    '蛋白質來源：雞',
    '媽（蛋奶素）可吃素版',
    '估 鈉 466 mg／份，不高於主菜池子的中位數 485',
    '估 碳水化合物（醣） 6 g／份，不高於主菜池子的中位數 8',
    '比較豐盛：估每份熱量、飽和脂肪在主菜裡偏高；這週第 1 道豐盛的主菜，在一週 4 道內',
    '老薑、蒜頭這幾天已經會買',
    '約 30 分鐘，滷／燉',
    '你勾了「本週想吃」',
  ];
  const kept = plainReasons(sample);
  eq(kept, ['14 天內沒出現過', '蛋白質來源：雞', '媽（蛋奶素）可吃素版', '老薑、蒜頭這幾天已經會買', '約 30 分鐘，滷／燉', '你勾了「本週想吃」'],
    '留下不帶估算數字的六句；三句帶「估」或「中位數」的拿掉');
  noneOf(kept, (t) => /估|中位數/.test(t), '留下來的沒有一句含「估」或「中位數」');
  eq(plainReasons(undefined), [], '沒有理由就回空陣列（不會炸）');
  // 真實菜單：留意欄位最多的家庭，每一道菜過濾後仍至少留一句（不會變成一張空卡）
  const watchers = [{ ...newMember(), name: '阿公', conditions: ['hypertension', 'diabetes', 'lipid', 'osteoporosis'] }];
  const wp = gen({ members: watchers, seed: 'plain' });
  const allItems = cookSlots(wp.plan).flatMap((s) => s.items);
  ok(allItems.length >= 40, `（母體）${allItems.length} 道菜`);
  const rawWithEst = allItems.filter((it) => (it.reasons ?? []).some((t) => /估/.test(t))).length;
  ok(rawWithEst >= 30, `（前提）這個家庭 ${rawWithEst} 道菜的原始理由裡有「估 …」—— 過濾才有東西可過濾`);
  everyOf(allItems, (it) => plainReasons(it.reasons).length >= 1, '每一道過濾後仍至少留一句');
  everyOf(allItems, (it) => plainReasons(it.reasons).every((t) => !/估|中位數/.test(t)), '每一道過濾後都沒有估算數字');
}

section('理由是事實，不是建議');
const allReasons = cookSlots(a.plan).flatMap((s) => s.items.flatMap((it) => it.reasons));
ok(allReasons.length >= 100, `（母體）${allReasons.length} 條理由`);
noneOf(allReasons, (t) => /建議|應該|適合|療效|治療|控制|改善|健康的選擇/.test(t), '沒有建議語氣或療效字眼');
ok(allReasons.some((t) => /天內沒出現過/.test(t)), '有「N 天內沒出現過」這種事實');
ok(allReasons.some((t) => /蛋白質來源/.test(t)), '有蛋白質來源');
ok(allReasons.some((t) => /約 \d+ 分鐘/.test(t)), '有時間');
detects((t) => /建議|應該|適合|療效|治療|控制|改善/.test(t), {
  shouldHit: ['建議多吃這道', '適合糖尿病患者', '有助控制血糖', '這道很健康應該常吃'],
  shouldMiss: ['估 鈉 320 mg／份，不高於主菜池子的中位數 450', '14 天內沒出現過', '姊（全素）可吃素版', '當季（9 月）'],
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
  eq(mixed.meaty, mixed.total, `有全素（不吃五辛）的成員時也一樣（${mixed.meaty}/${mixed.total}）—— 靠的是可分流的菜，素食成員吃素版`);
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

section('家裡有人留意醣 → 主食「優先」排全穀雜糧（是加分，不是規定）');
{
  // 舊版斷言是「主食全部都是全穀」。那在只有 5 道主食的池子裡是巧合：食譜補到 172 道之後，
  // 當季的芋頭飯、麵條也會被排進來，斷言就紅了 —— 但規劃器並沒有壞。
  // PLAN §4.1 寫的是「優先排糙米／雜糧飯」，優先＝加分。加分做得到什麼，要用**比例**量，
  // 而且要有對照組：沒有人留意醣的同一個家庭，比例應該明顯低很多。
  const share = (members) => {
    let whole = 0; let total = 0; const names = new Set();
    for (const seed of ['test', 's2', 's3', 's4', 's5', 's6', 's7', 's8']) {
      const { plan } = gen({ members, seed }); // 預設白米：可選的是白飯、地瓜飯（全穀）、芋頭飯、白麵條
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
  ok(watch.total >= 80 && plain.total >= 80, `（母體）八週各排了 ${watch.total}／${plain.total} 個主食格`);
  // 2026-09-18 起主食的米照家裡的設定（預設白米），全穀的只剩地瓜飯一道，而且同一天不排兩次、
  // 它的醣又高於主食池中位數（留意醣的扣分會抵掉一部分加分），差距變小。八組種子實測：有留意 36%、對照 26%、差 10 個百分點；
  // 門檻各留約 5 個百分點。加分那一行有沒有觸發，另外用同一道地瓜飯直接驗（下一段），不靠統計。
  // 2026-09-18 起主食格只排設定的米（白麵條不再進主食格），白米池子是白飯、地瓜飯、芋頭飯 —— 全穀（地瓜飯）的基準約三分之一。
  // 八組種子實測：有留意 52%、對照 32%、差 19 個百分點。
  ok(watch.pct >= 0.42, `有人留意醣：全穀主食 ${watch.whole}/${watch.total}（${Math.round(watch.pct * 100)}%）`);
  ok(plain.pct <= 0.42, `（對照）沒有人留意醣的同一個家庭只有 ${plain.whole}/${plain.total}（${Math.round(plain.pct * 100)}%）—— 差別是那個加分做出來的`);
  ok(watch.pct - plain.pct >= 0.1, `兩者差 ${Math.round((watch.pct - plain.pct) * 100)} 個百分點`);
  {
    const sp = byId.get('r-sweet-potato-rice');
    const at = { role: 'staple', meal: 'dinner', date: MONDAY, day: 0 };
    const st = () => ({ slotItems: [], dayRecipes: () => new Set(), lastServed: () => null, placedWant: new Set() });
    const withD = buildContext({ recipes, members: [{ ...newMember(), name: '阿嬤', conditions: ['diabetes'] }], idx, units });
    const noD = buildContext({ recipes, members: [{ ...newMember(), name: '媽' }], idx, units });
    const reasonsD = scoreSoft(sp, at, withD, st(), () => 0).reasons;
    ok(reasonsD.includes('全穀雜糧主食（家中有留意醣的成員）'), `同一道地瓜飯：家裡有人留意醣時多一句「全穀雜糧主食（家中有留意醣的成員）」`);
    ok(!scoreSoft(sp, at, noD, st(), () => 0).reasons.some((t) => t.includes('家中有留意醣')), '（對照）沒有人留意醣時沒有這一句');
  }
  ok(watch.names.length >= 2, `而且不是只排同一種：${watch.names.join('、')}`);
}

section('主食的米（2026-09-18 第 9 項）：照家裡的設定排，預設白米，不自動換；麵條不受影響');
{
  eq(DEFAULT_RULES.riceKind, 'white', '預設白米');
  eq(RICE_KINDS.map((k) => RICE_KIND_LABELS[k]), ['白米', '糙米', '五穀米'], '三種：白米／糙米／五穀米');
  eq(['稉米平均值', '秈米平均值', '糙稉米平均值', '發芽稉米平均值', '五穀米', '秈米粉', '稉型糯米平均值', '米胚芽'].map(riceKindOfFood),
    ['white', 'white', 'brown', 'brown', 'multigrain', null, null, null], '食材判斷：稉米／秈米是白米、糙米是糙米、五穀米；米粉、糯米、米胚芽不算煮飯的米');
  const staples = recipes.filter((r) => r.role === 'staple');
  eq(Object.fromEntries(staples.map((r) => [r.name, riceKindOf(r, idx)])),
    { 糙米飯: 'brown', 五穀飯: 'multigrain', 白麵條: null, 地瓜飯: 'white', 芋頭飯: 'white', 白飯: 'white' }, '內建六道主食各自是哪一種米（麵條沒有米）');
  noneOf(RICE_RED_WORDS, (w) => RICE_KIND_HINT.includes(w), `設定旁的說明是中性的：${RICE_KIND_HINT}`);

  const staplesOf = (rules, members = []) => {
    const names = [];
    for (const seed of ['test', 's2', 's3', 's4']) {
      const { plan } = gen({ members, seed, rules });
      for (const sl of cookSlots(plan)) for (const it of sl.items.filter((x) => x.role === 'staple')) names.push(byId.get(it.recipeId).name);
    }
    return names;
  };
  const count = (arr) => Object.fromEntries([...new Set(arr)].map((n) => [n, arr.filter((x) => x === n).length]));
  const diab = [{ ...newMember(), name: '爸' }, { ...newMember(), name: '阿嬤', conditions: ['diabetes'] }];
  const white = staplesOf({}, diab);
  ok(white.length >= 40, `（母體）四週 ${white.length} 個主食格（家裡有人留意醣）`);
  noneOf(white, (n) => n === '糙米飯' || n === '五穀飯', `預設白米：有人留意醣也不會自動換成糙米或五穀飯（${JSON.stringify(count(white))}）`);
  ok(['白飯', '地瓜飯', '芋頭飯'].filter((n) => white.includes(n)).length >= 2, '白米會在白飯、地瓜飯、芋頭飯之間輪流（至少兩種）');
  eq(white.filter((n) => n === '白麵條').length, 0, '主食格一次都沒有白麵條（2026-09-18 Yolin：設了哪一種米，主食格就只排那種米）');
  for (const [kind, rice] of [['brown', '糙米飯'], ['multigrain', '五穀飯']]) {
    const got = staplesOf({ riceKind: kind });
    ok(got.length >= 40, `（母體）設${RICE_KIND_LABELS[kind]}：四週 ${got.length} 個主食格`);
    everyOf(got, (n) => n === rice, `設${RICE_KIND_LABELS[kind]}：主食格 100% 是${rice}（0 白麵條、0 其他主食）`);

  }
  // 2026-09-18 Yolin 實測設了五穀米，主食格還是出現白麵條。多種家庭 × 多組種子 × 連排多週，一格都不能漏。
  {
    const FAMS = {
      葷食: [{ ...newMember(), name: '爸' }],
      有蛋奶素: [{ ...newMember(), name: '爸' }, { ...newMember(), name: '姊', diet: 'lactoOvo' }],
      全家全素: [{ ...newMember(), name: '姊', diet: 'veganNoAllium' }],
    };
    for (const kind of RICE_KINDS) {
      const kinds = new Map(); let slots = 0; let emptyStaple = 0; let noodle = 0;
      for (const members of Object.values(FAMS)) {
        for (let sd = 0; sd < 8; sd += 1) {
          let history = [];
          for (let w = 0; w < 3; w += 1) {
            const { plan, diagnostics } = generateWeek({ recipes, members, idx, units, rules: { riceKind: kind }, favorites: [], history, mondayIso: addDays(MONDAY, 7 * w), seed: `rk${sd}`, shoppingDays: [3, 6] });
            history = [...history, ...rowsOf(plan)];
            emptyStaple += diagnostics.empty.filter((e) => e.role === 'staple').length;
            for (const sl of cookSlots(plan)) for (const it of sl.items.filter((x) => x.role === 'staple')) {
              slots += 1;
              const r = byId.get(it.recipeId);
              const k = riceKindOf(r, idx) ?? '（沒有米）';
              kinds.set(k, (kinds.get(k) ?? 0) + 1);
              if (r.name.includes('麵')) noodle += 1;
            }
          }
        }
      }
      ok(slots >= 900, `（母體）設${RICE_KIND_LABELS[kind]}：三種家庭 × 8 組種子 × 3 週，${slots} 個主食格`);
      eq([...kinds.keys()], [kind], `設${RICE_KIND_LABELS[kind]}：主食格 100% 是${RICE_KIND_LABELS[kind]}（${JSON.stringify(Object.fromEntries(kinds))}）`);
      eq(noodle, 0, `設${RICE_KIND_LABELS[kind]}：0 白麵條`);
      eq(emptyStaple, 0, `設${RICE_KIND_LABELS[kind]}：主食格沒有排出空格`);
    }
    // 麵類當主菜的不受影響：炒米粉這類本身含主食，那一餐的主食格略過（不是被換成麵）
    const noodleMain = recipes.find((r) => r.role === 'main' && r.includesStaple);
    ok(noodleMain, `（前提）有含主食的主菜：${noodleMain?.name}`);
  }
  eq(buildContext({ recipes, idx, units, rules: { riceKind: 'jasmine' } }).rules.riceKind, 'white', '亂填的設定 → 當白米');
  eq(gen({ rules: { riceKind: 'multigrain', heartyLevel: 'low', vegProtein: false } }).diagnostics.rules, { heartyLevel: 'low', riceKind: 'multigrain', vegProtein: false }, '排菜器把實際用的豐盛程度與米記在 diagnostics.rules（跟著 plan 存）');
  eq(gen({}).diagnostics.rules, { heartyLevel: 'medium', riceKind: 'white', vegProtein: true }, '沒設就記預設：適中、白米、素食每餐一道蛋豆奶開著');
  {
    const bctx = buildContext({ recipes, idx, units, rules: { riceKind: 'brown' } });
    const lunchHad = { slotItems: [], dayRecipes: () => new Set(['r-brown-rice', 'r-plain-noodles']) };
    eq(hardBlock(byId.get('r-brown-rice'), { role: 'staple', meal: 'dinner', date: '2026-09-14' }, bctx, lunchHad), null, '設糙米：午餐吃過糙米飯，晚餐照樣可以排（只有一道飯，不套同一天不重複）');
    eq(hardBlock(byId.get('r-plain-noodles'), { role: 'staple', meal: 'dinner', date: '2026-09-14' }, bctx, lunchHad), 'sameDay', '（對照）麵條午餐吃過，晚餐照舊不重複');
    const wctx = buildContext({ recipes, idx, units, rules: {} });
    eq(hardBlock(byId.get('r-white-rice'), { role: 'staple', meal: 'dinner', date: '2026-09-14' }, wctx, { slotItems: [], dayRecipes: () => new Set(['r-white-rice']) }), 'sameDay', '（對照）白米有三道飯可以輪，白飯照舊同一天不重複');
  }

  const ctxW = buildContext({ recipes, members: [], idx, units, shoppingDays: [3, 6], wantThisWeek: [] });
  const { plan: wp } = gen({});
  const why = wantMissReason(byId.get('r-brown-rice'), wp.slots, ctxW);
  ok(why.includes('主食的米用白米'), `勾了「本週想吃」糙米飯但設定白米：本週頁講得出原因（${why}）`);
}

section('主角食材短期不要太常出現（2026-09-18 Yolin：三天內午晚餐出現四道杏鮑菇）');
{
  const nameOf = (k) => displayNameOf(idx.byId.get(k), idx);
  const stars = (id, v) => starFoods(byId.get(id), v, idx).map(nameOf);
  eq(stars('r-three-cup-split', 'veg'), ['杏鮑菇'], '三杯杏鮑菇（素版）的主角是杏鮑菇');
  ok(!stars('r-three-cup-split', 'meat').includes('杏鮑菇'), `三杯雞（葷版）的主角不含杏鮑菇：${stars('r-three-cup-split', 'meat').join('、')}`);
  const potatoPork = recipes.find((r) => r.name.startsWith('馬鈴薯燉肉'));
  ok(!starFoods(potatoPork, 'meat', idx).map(nameOf).includes('胡蘿蔔'), '馬鈴薯燉肉裡的胡蘿蔔是配角，不算主角');
  noneOf(recipes.flatMap((r) => ['veg', 'meat', 'all'].flatMap((v) => starFoods(r, v, idx))), (k) => /蔥|蒜|薑|辣椒|九層塔/.test(idx.byId.get(k).name), '蔥蒜薑辣椒九層塔從來不算主角');
  everyOf(recipes, (r) => ['veg', 'meat', 'all'].every((v) => starFoods(r, v, idx).length <= 2), '每一道每個版本最多兩樣主角');
  // 家人吃哪個版本就看哪個版本：葷食家庭吃三杯雞，杏鮑菇不算
  const omniCtx = buildContext({ recipes, members: [{ ...newMember(), name: '爸' }], idx, units });
  const vegCtx = buildContext({ recipes, members: [{ ...newMember(), name: '爸' }, { ...newMember(), name: '姊', diet: 'lactoOvo' }], idx, units });
  const cup = byId.get('r-three-cup-split');
  ok(!omniCtx.starsOf(cup).map(nameOf).includes('杏鮑菇'), '全家吃葷：三杯雞不算一次杏鮑菇');
  ok(vegCtx.starsOf(cup).map(nameOf).includes('杏鮑菇'), '家裡有吃素的：三杯（素版杏鮑菇）算一次杏鮑菇');

  // 扣分直接驗：同一道三杯，前後幾天已經排了 0／1／2 道杏鮑菇
  const kCup = starFoods(cup, 'veg', idx)[0];
  const at = { role: 'main', meal: 'dinner', date: '2026-09-16', day: 2 };
  const st = (n) => ({ slotItems: [], dayRecipes: () => new Set(), lastServed: () => null, timesServedWithin: () => 0, dayProteins: () => new Set(), prevDayMealProteins: () => new Set(), fishCount: () => 0, rangeHas: () => false, placedWant: new Set(), starCount: (k) => (k === kCup ? n : 0) });
  const sc = (n) => scoreSoft(cup, at, vegCtx, st(n), () => 0);
  eq([sc(1).score - sc(0).score, sc(2).score - sc(0).score, sc(3).score - sc(0).score].map(Math.round), [-12, -45, -90], '前後幾天已有 1／2／3 道杏鮑菇 → 扣 12／45／90 分');
  ok(sc(2).reasons.includes('杏鮑菇前後幾天已經排了 2 道'), '「為什麼選這道」照實講（沒有數字估算，所以會印在卡上）');
  ok(!sc(0).reasons.some((t) => t.includes('前後幾天已經排了')), '（對照）沒排過就沒有這一句');
  eq(STAR_WINDOW_DAYS, 2, '看前後各 2 天（連續三天的任何一段都涵蓋）');

  // 統計：三種家庭 × 12 組種子 × 連排 3 週，數每一段連續三天午晚餐的主角食材。
  // 2026-09-18 實測（沒有這條規則 → 有）：出現 4 次以上的段落 17／48／39 → 0／0／0；出現 3 次的 61／159／153 → 0／21／43。
  const FAMS = {
    葷食: [{ ...newMember(), name: '爸' }, { ...newMember(), name: '媽' }],
    有蛋奶素: [{ ...newMember(), name: '爸' }, { ...newMember(), name: '媽' }, { ...newMember(), name: '姊', diet: 'lactoOvo' }],
    有全素: [{ ...newMember(), name: '爸' }, { ...newMember(), name: '姊', diet: 'veganNoAllium' }],
  };
  const measure = (members, starSpacing) => {
    const ctx = buildContext({ recipes, members, idx, units });
    const out = { windows: 0, ge3: 0, ge4: 0, worst: 0, empty: 0, dishes: new Set(), vegMin: 99, ex: '' };
    for (let sd = 0; sd < 12; sd += 1) {
      let history = [];
      for (let w = 0; w < 3; w += 1) {
        const { plan, diagnostics } = generateWeek({ recipes, members, idx, units, rules: { starSpacing }, favorites: [], history, mondayIso: addDays(MONDAY, 7 * w), seed: `star${sd}`, shoppingDays: [3, 6] });
        history = [...history, ...rowsOf(plan)];
        out.empty += diagnostics.empty.length;
        const byDate = new Map();
        for (const sl of plan.slots) {
          if (sl.kind !== 'cook' || sl.meal === 'breakfast') continue;
          const veg = members.find((m) => m.diet !== 'omni');
          if (veg) out.vegMin = Math.min(out.vegMin, sl.items.filter((it) => vFor(byId.get(it.recipeId), veg.diet)).length);
          for (const it of sl.items) {
            out.dishes.add(it.recipeId);
            const r = byId.get(it.recipeId);
            if (['main', 'side', 'soup'].includes(r.role)) { if (!byDate.has(sl.date)) byDate.set(sl.date, []); byDate.get(sl.date).push(r); }
          }
        }
        const dates = [...byDate.keys()].sort();
        for (let i = 0; i + 2 < dates.length; i += 1) {
          const cnt = new Map();
          for (const d of dates.slice(i, i + 3)) for (const r of byDate.get(d)) for (const k of ctx.starsOf(r)) cnt.set(k, (cnt.get(k) ?? 0) + 1);
          const mx = Math.max(0, ...cnt.values());
          out.windows += 1; if (mx >= 3) out.ge3 += 1; if (mx >= 4) out.ge4 += 1;
          if (mx > out.worst) { out.worst = mx; out.ex = [...cnt].filter(([, n]) => n === mx).map(([k]) => nameOf(k)).join('、'); }
        }
      }
    }
    return out;
  };
  for (const [fname, members] of Object.entries(FAMS)) {
    const on = measure(members, true);
    const off = measure(members, false);
    ok(on.windows >= 150, `（母體）${fname}：${on.windows} 段連續三天`);
    ok(off.ge4 >= 5, `（對照）${fname}：沒有這條規則時，同一樣主角食材三天內出現 4 次以上的有 ${off.ge4} 段（最多 ${off.worst} 次，${off.ex}）`);
    eq(on.ge4, 0, `${fname}：有這條規則，三天內同一樣主角食材沒有任何一段出現 4 次以上（最多 ${on.worst} 次）`);
    ok(on.ge3 <= 0.4 * off.ge3, `${fname}：出現 3 次的段落 ${off.ge3} → ${on.ge3}（≤ 四成；實測最多約三成）`);
    eq(on.empty, 0, `${fname}：沒有因此排出空格（是扣分，不是排除）`);
    ok(on.dishes.size >= 0.9 * off.dishes.size, `${fname}：菜色種類沒有被壓掉（${off.dishes.size} → ${on.dishes.size} 道，≥ 九成）`);
    if (members.some((m) => m.diet !== 'omni')) ok(on.vegMin >= 3, `${fname}：素食成員每一餐仍吃得到 ≥ 3 道（最少 ${on.vegMin}）`);
  }
  // 跨週：上週六、日排了三道杏鮑菇（歷史紀錄），這週一的午晚餐要避開。一位蛋奶素的家庭，60 組種子。
  {
    const vegOnly = [{ ...newMember(), name: '姊', diet: 'lactoOvo' }];
    const vctx = buildContext({ recipes, members: vegOnly, idx, units });
    const eryngii = recipes.filter((r) => ['main', 'side'].includes(r.role) && vctx.starsOf(r).includes(kCup)).map((r) => r.id);
    ok(eryngii.length >= 5, `（母體）主角是杏鮑菇的主菜配菜 ${eryngii.length} 道`);
    const picked = new Set();
    const monHits = (history) => {
      let n = 0;
      for (let sd = 0; sd < 60; sd += 1) {
        // 只看主角食材這條：蛋白質偏好關掉（開著時豆腐會把杏鮑菇擠掉，對照組就量不到東西）
        const { plan } = generateWeek({ recipes, members: vegOnly, idx, units, rules: { vegProtein: false }, favorites: [], history, mondayIso: MONDAY, seed: `wk${sd}`, shoppingDays: [] });
        for (const sl of plan.slots.filter((x) => x.date === MONDAY && x.meal !== 'breakfast')) {
          const hit = sl.items.filter((it) => vctx.starsOf(byId.get(it.recipeId)).includes(kCup));
          if (hit.length) n += 1;
          if (!history.length) for (const it of hit) picked.add(it.recipeId);
        }
      }
      return n;
    };
    const base = monHits([]);
    // 歷史裡放的是「基準裡週一從沒被排到」的杏鮑菇菜 —— 不然週一少排，也可能只是「同一道 14 天不重複」擋的，不是這條規則
    const others = eryngii.filter((id) => !picked.has(id));
    ok(others.length >= 3, `（前提）有 ${others.length} 道杏鮑菇菜在基準裡週一沒被排到，拿來當上週的紀錄`);
    const hist = [{ date: addDays(MONDAY, -2), recipeId: others[0], meal: 'dinner', role: 'main' }, { date: addDays(MONDAY, -1), recipeId: others[1], meal: 'lunch', role: 'main' }, { date: addDays(MONDAY, -1), recipeId: others[2], meal: 'dinner', role: 'side' }];
    const after = monHits(hist);
    ok(base >= 3, `（對照）上週沒吃杏鮑菇時，60 組裡週一午晚餐排到杏鮑菇 ${base} 次`);
    eq(after, 0, `上週六、日已經吃了三道杏鮑菇 → 週一午晚餐 120 餐一次都沒排到（上週的紀錄有算進來）`);
  }
}

section('素食成員每餐一道蛋、豆製品或奶類的菜（2026-09-18 Yolin 定案，家人頁開關，預設開）');
{
  const byName = (n) => recipes.find((r) => r.name.startsWith(n));
  const ants = byName('螞蟻上樹');
  ok(ants.proteins.includes('pork') && !ants.vegProteins.includes('pork'), `蛋白質來源按版本分開：螞蟻上樹全部是 ${ants.proteins.join('、')}，素版 ${ants.vegProteins.join('、') || '（沒有）'} —— 素版不算豬肉`);
  ok(ants.meatProteins.includes('pork'), '（對照）葷版照樣是豬肉');
  everyOf(recipes.filter((r) => r.vegMode === 'splittable'), (r) => Array.isArray(r.vegProteins) && Array.isArray(r.meatProteins), '每一道可分流的菜都有素版、葷版各自的蛋白質來源');
  eq(isProteinDish(byName('家常麻婆豆腐'), 'veg', idx), true, '麻婆豆腐（素版）是豆製品的菜');
  eq(isProteinDish(byName('番茄炒蛋'), 'all', idx), true, '番茄炒蛋是蛋的菜');
  eq(isProteinDish(byName('起司焗南瓜'), 'all', idx), true, '起司焗南瓜是奶類的菜');
  eq(isProteinDish(byName('蒜炒空心菜'), 'all', idx), false, '炒青菜不是');
  // 份量門檻：自己組一道菜，豆豉每人 2.5 克（不是常備品）→ 不算；同一道換成每人 25 克的豆腐 → 算
  const fakeDish = (food, grams) => ({ id: 'r-fake', role: 'side', servings: 4, vegMode: 'nativeVeg', ingredients: [{ food: 'E3201202', label: '青江菜', grams: 300, track: 'base' }, { food, label: 'x', grams, track: 'base' }] });
  eq(isProteinDish(fakeDish('R4700601', 10), 'all', idx), false, '一小撮豆豉（每人 2.5 克）不算 —— 每人至少 15 克才算');
  eq(isProteinDish(fakeDish('R4700901', 100), 'all', idx), true, '（對照）每人 25 克的豆腐算');
  eq(isProteinDish(ants, 'veg', idx), false, '素螞蟻上樹不是（冬粉、蔬菜）');
  const vegan = { ...newMember(), name: '姊', diet: 'veganNoAllium' };
  eq(proteinDishFor(byName('番茄炒蛋'), vegan, idx), false, '全素的姊吃不了番茄炒蛋 → 對她不算');

  // 加分直接驗
  const fam = [{ ...newMember(), name: '爸' }, vegan];
  const ctxOn = buildContext({ recipes, members: fam, idx, units });
  const ctxOff = buildContext({ recipes, members: fam, idx, units, rules: { vegProtein: false } });
  const tofu = recipes.find((r) => r.role === 'side' && r.vegMode === 'nativeVeg' && isProteinDish(r, 'all', idx) && proteinDishFor(r, vegan, idx));
  const greens = byName('蒜炒空心菜');
  ok(tofu, `（前提）找到一道全素吃得到的豆製品配菜：${tofu?.name}`);
  const at = { role: 'side', meal: 'dinner', date: '2026-09-16', day: 2 };
  const st = (items) => ({ slotItems: items, dayRecipes: () => new Set(), lastServed: () => null, timesServedWithin: () => 0, dayProteins: () => new Set(), prevDayMealProteins: () => new Set(), fishCount: () => 0, rangeHas: () => false, placedWant: new Set(), starCount: () => 0 });
  const sc = (ctx, r, items) => scoreSoft(r, at, ctx, st(items), () => 0);
  const noProtYet = [{ recipeId: greens.id, role: 'main', pos: 0 }];
  // 晚餐是主菜、配菜、配菜、湯、主食；混合家庭最後一道配菜會是給葷食的加菜。
  // 只排了主菜 → 這格（配菜）之後還有湯可以補 → 只加一點；主菜＋一道配菜都排了 → 這是最後一個位置 → 加滿
  eq(Math.round(sc(ctxOn, tofu, noProtYet).score - sc(ctxOff, tofu, noProtYet).score), VEG_PROTEIN_EARLY_BONUS, `姊還沒有、後面還有位置可以補 → 只加 ${VEG_PROTEIN_EARLY_BONUS} 分（主菜照原本的變化挑）`);
  const lastChance = [{ recipeId: greens.id, role: 'main', pos: 0 }, { recipeId: greens.id, role: 'side', pos: 1 }];
  eq(Math.round(sc(ctxOn, tofu, lastChance).score - sc(ctxOff, tofu, lastChance).score), VEG_PROTEIN_BONUS, `姊還沒有、這是最後一個她吃得到的位置 → 加 ${VEG_PROTEIN_BONUS} 分`);
  ok(sc(ctxOn, tofu, noProtYet).reasons.some((t) => t.includes('姊這一餐吃得到的蛋、豆製品或奶類的菜')), '理由只講組成：「姊這一餐吃得到的蛋、豆製品或奶類的菜」');
  noneOf(sc(ctxOn, tofu, noProtYet).reasons, (t) => /健康|蛋白質|營養|建議|應該|補充/.test(t), '理由沒有營養理由或建議語氣');
  const hasProt = [{ recipeId: tofu.id, role: 'main', pos: 0 }];
  eq(Math.round(sc(ctxOn, tofu, hasProt).score - sc(ctxOff, tofu, hasProt).score), 0, '這一餐已經有了 → 不再加');
  eq(Math.round(sc(ctxOn, greens, noProtYet).score - sc(ctxOff, greens, noProtYet).score), 0, '炒青菜不加');
  const stStar = { ...st(noProtYet), starCount: (k) => (starFoods(tofu, 'all', idx).includes(k) ? 2 : 0) };
  eq(Math.round(scoreSoft(tofu, at, ctxOn, stStar, () => 0).score - scoreSoft(tofu, at, ctxOff, stStar, () => 0).score), 0, '同一樣主角（豆腐）前後幾天已經 2 道 → 不加（三天內不要太常出現優先）');

  // 排不到的餐：從現在的菜單算
  const plan = { slots: [
    { date: '2026-09-14', meal: 'lunch', kind: 'cook', items: [{ recipeId: greens.id }] },
    { date: '2026-09-14', meal: 'dinner', kind: 'cook', items: [{ recipeId: greens.id }, { recipeId: tofu.id }] },
    { date: '2026-09-14', meal: 'breakfast', kind: 'cook', items: [{ recipeId: greens.id }] },
    { date: '2026-09-15', meal: 'lunch', kind: 'eatOut', items: [] },
  ] };
  eq(vegProteinMisses(plan, fam, byId, idx), [{ date: '2026-09-14', meal: 'lunch', names: ['姊'] }], '只列週一午餐（晚餐有豆腐；早餐、外食不算）');
  eq(vegProteinMisses(plan, [{ ...newMember(), name: '爸' }], byId, idx), [], '沒有素食成員 → 什麼都不列');

  // 統計：三種家庭 × 8 組種子 × 連排 3 週，開與關比
  const FAMS = {
    有蛋奶素: [{ ...newMember(), name: '爸' }, { ...newMember(), name: '媽' }, { ...newMember(), name: '姊', diet: 'lactoOvo' }],
    有全素: [{ ...newMember(), name: '爸' }, { ...newMember(), name: '姊', diet: 'veganNoAllium' }],
    全家全素: [{ ...newMember(), name: '姊', diet: 'veganNoAllium' }],
  };
  const LIMIT = { 有蛋奶素: [0.15, 0.05], 有全素: [0.3, 0.2], 全家全素: [0.2, 0.1] }; // [關的時候至少, 開的時候至多]
  const SOY_RX = /豆腐|豆干|豆皮|麵腸|百頁/;
  const run = (members, vegProtein) => {
    const ctx = buildContext({ recipes, members, idx, units });
    const out = { meals: 0, miss: 0, empty: 0, ge4: 0, soyDish: 0, soy3: 0, days: 0, windows: 0, dishes: new Set(), vegMin: 99 };
    for (let sd = 0; sd < 8; sd += 1) {
      let history = [];
      for (let w = 0; w < 3; w += 1) {
        const { plan: pl, diagnostics } = generateWeek({ recipes, members, idx, units, rules: { vegProtein }, favorites: [], history, mondayIso: addDays(MONDAY, 7 * w), seed: `vp${sd}`, shoppingDays: [3, 6] });
        history = [...history, ...rowsOf(pl)];
        out.empty += diagnostics.empty.length;
        out.miss += vegProteinMisses(pl, members, byId, idx).length;
        const byDate = new Map();
        for (const sl of pl.slots) {
          if (sl.kind !== 'cook' || sl.meal === 'breakfast') continue;
          out.meals += 1;
          const veg = members.find((m) => m.diet !== 'omni');
          out.vegMin = Math.min(out.vegMin, sl.items.filter((it) => vFor(byId.get(it.recipeId), veg.diet)).length);
          for (const it of sl.items) {
            out.dishes.add(it.recipeId);
            const r = byId.get(it.recipeId);
            if (!['main', 'side', 'soup'].includes(r.role)) continue;
            if (!byDate.has(sl.date)) byDate.set(sl.date, []);
            byDate.get(sl.date).push(r);
            if (ctx.starsOf(r).some((k) => SOY_RX.test(idx.byId.get(k).name))) out.soyDish += 1;
          }
        }
        const dates = [...byDate.keys()].sort();
        out.days += dates.length;
        for (let i = 0; i + 2 < dates.length; i += 1) {
          const cnt = new Map();
          for (const d of dates.slice(i, i + 3)) for (const r of byDate.get(d)) for (const k of ctx.starsOf(r)) cnt.set(k, (cnt.get(k) ?? 0) + 1);
          out.windows += 1;
          if (Math.max(0, ...cnt.values()) >= 4) out.ge4 += 1;
          if (Math.max(0, ...[...cnt].filter(([k]) => SOY_RX.test(idx.byId.get(k).name)).map(([, n]) => n)) >= 3) out.soy3 += 1;
        }
      }
    }
    return out;
  };
  for (const [fname, members] of Object.entries(FAMS)) {
    const off = run(members, false);
    const on = run(members, true);
    const pct = (o) => o.miss / o.meals;
    ok(on.meals >= 300, `（母體）${fname}：${on.meals} 個午晚餐`);
    ok(pct(off) >= LIMIT[fname][0], `（對照）${fname}：開關關著時，素食成員沒有蛋、豆製品或奶類菜的餐 ${off.miss}/${off.meals}（${Math.round(pct(off) * 100)}%）`);
    ok(pct(on) <= LIMIT[fname][1], `${fname}：開關開著 → ${on.miss}/${on.meals}（${Math.round(pct(on) * 100)}%，≤ ${LIMIT[fname][1] * 100}%）`);
    eq(on.empty, 0, `${fname}：沒有排出空格（加分，不是硬擋）`);
    eq(on.ge4, 0, `${fname}：主角食材三天內出現 4 次以上的段落仍然是 0（第 4 項那條優先）`);
    ok(on.vegMin >= 3, `${fname}：素食成員每一餐仍吃得到 ≥ 3 道`);
    ok(on.dishes.size >= 0.9 * off.dishes.size, `${fname}：菜色種類 ${off.dishes.size} → ${on.dishes.size}（≥ 九成）`);
    // 誠實記下拉扯：豆製品當主角的菜變多了；「同一樣豆製品三天三次」不能比關著時多太多
    // 段落數約 170；個位數的差是亂數序列的跳動（2026-09-18 換主食規則後蛋奶素量到 1 → 7，前一版是 2 → 1）
    ok(on.soy3 <= off.soy3 + 0.06 * on.windows, `${fname}：豆製品當主角的菜每天 ${(off.soyDish / off.days).toFixed(2)} → ${(on.soyDish / on.days).toFixed(2)} 道；同一樣豆製品三天內 3 次的段落 ${off.soy3} → ${on.soy3}／${on.windows} 段（不多於關著時＋段落數的 6%）`);
  }
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
  // 使用者自己加的菜裡有查不到的食材：這一天的數字只是部分估算，要記下來讓本週頁、今日煮講出來
  const fish = byId.get('r-steamed-fish');
  const earDish = { ...fish, id: 'r-user-ear-est', ingredients: [{ food: null, label: '豬耳朵', grams: 300, track: 'base', unresolved: true }, ...fish.ingredients], tags: [...fish.tags, 'unresolved'] };
  const withEar = new Map([...byId, [earDish.id, earDish]]);
  const rows3 = dailyEstimates([{ ...slots[0], items: [{ recipeId: earDish.id, role: 'main' }, { recipeId: split.id, role: 'side' }] }], [{ ...newMember(), name: '爸', diet: 'omni' }], idx, withEar, ['kcal']);
  eq(rows3[0].partialDishes, 1, '一天裡有一道菜含查不到的食材 → partialDishes 1（畫面講「部分估算」）');
  ok(!('partialDishes' in rows2[0]), '（對照）沒有這種菜時不多出這個欄位');
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
        shelfClaims.push({ line, blocker: shelfBlocker(byId.get(it.recipeId), s.date, tightCtx), all: shelfOverdue(byId.get(it.recipeId), s.date, tightCtx) });
      }
    }
  }
  ok(shelfClaims.length >= 1, `（母體）這週有 ${shelfClaims.length} 句保存期限的理由`);
  everyOf(shelfClaims, (c) => c.blocker !== null, '每一句保存期限的理由，這道菜在那一天**真的**有食材撐不到');
  everyOf(shelfClaims, (c) => c.line.includes(c.blocker.label), '而且句子裡講的食材就是實際擋住的那一個');

  // 冷凍那句只對肉魚講：叫人把九層塔、青江菜冷凍是錯的。一句話可能同時講肉（要冷凍）與菜（不耐放），逐樣看它落在哪一半。
  // 2026-09-18 起每一樣放不住的都講（以前只講第一樣：牛肉要冷凍講了，空心菜放 6 天沒講）。
  const halves = (line) => { const [a, b = ''] = line.split('；'); return a.includes('要先冷凍') ? { frozen: a, fresh: b } : { frozen: '', fresh: a }; };
  everyOf(shelfClaims, (c) => c.all.every((b) => c.line.includes(b.label)), '每一樣放不住的食材都有講到（不是只講第一樣）');
  everyOf(shelfClaims, (c) => c.all.every((b) => (FREEZABLE_CATS.has(b.cat) ? halves(c.line).frozen.includes(b.label) : !halves(c.line).frozen.includes(b.label))), '「要先冷凍」只講肉類與魚貝類');
  everyOf(shelfClaims, (c) => c.all.filter((b) => !FREEZABLE_CATS.has(b.cat)).every((b) => halves(c.line).fresh.includes(b.label) && c.line.includes('不耐放')), '蔬菜、菇、辛香料那些講的是「不耐放」，不是叫人冷凍');
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
    '含全素（不吃五辛）': [{ ...newMember(), name: 'a' }, { ...newMember(), name: 'b', diet: 'veganNoAllium' }],
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

section('早餐輪替：一週裡不要一直回到同幾道（2026-09-19 補 14 道早餐時一起調）');
// 早餐不套「幾天內不重複」，只有輪替扣分。原本扣 2：跟「這幾天已經會買」（同一趟買菜共用食材，最多 +12）比起來太小，
// 用到豆腐、高麗菜、香菇的那幾道全素早餐會一直被拉回來 —— 有全素成員的家庭 7 天內再出現 14%。
{
  const ctxR = buildContext({ recipes, members: [], idx, units, shoppingDays: [3, 6] });
  const bf = recipes.find((r) => r.id === 'r-bf-miso-tofu-rice-soup');
  ok(!!bf, '（母體）味噌豆腐湯泡飯在池子裡');
  const stateN = (n) => ({ slotItems: [], placedWant: new Set(), lastServed: () => (n ? 3 : null), timesServedWithin: () => n, dayProteins: () => new Set(), prevDayMealProteins: () => new Set(), fishCount: () => 0, rangeHas: () => false });
  const info = { role: 'breakfast', meal: 'breakfast', date: '2026-09-17', day: 3 };
  const s0 = scoreSoft(bf, info, ctxR, stateN(0), makeRng('rot')).score;
  const s1 = scoreSoft(bf, info, ctxR, stateN(1), makeRng('rot')).score;
  const s2 = scoreSoft(bf, info, ctxR, stateN(2), makeRng('rot')).score;
  ok(s0 - s1 >= 6, `這 7 天吃過一次的早餐，分數少 ${(s0 - s1).toFixed(1)}（≥ 6；原本只少 2）`);
  ok(Math.abs((s0 - s2) - 2 * (s0 - s1)) < 1e-9, `吃過兩次少 ${(s0 - s2).toFixed(1)}，是一次的兩倍（照次數累加）`);

  // 從真實入口量：有全素（不吃五辛）成員的家庭，4 組種子 × 連排 4 週。
  // 門檻 10% ＝ Yolin 核准的驗收標準。2026-09-19 換 8 組種子組量：扣 6 時 1.8%～6.3%（這一組 3.6%）；
  // 扣回 2 時 12.5%～21.4%、完全不扣 36.6%～44.6% —— 10% 分得開，也不是只靠這一組種子剛好過。
  const WITHIN7_MAX = 0.10;
  const fam =[{ ...newMember(), name: '爸' }, { ...newMember(), name: '姊', diet: 'veganNoAllium' }];
  const pool = recipes.filter((r) => r.role === 'breakfast' && fam.every((m) => versionFor(r, m.diet) !== null));
  ok(pool.length >= 16, `（前提）姊吃得到的早餐 ${pool.length} 道（≥ 16）`);
  let slots = 0, within7 = 0, worstWeek = 0;
  for (const seed of ['r1', 'r2', 'r3', 'r4']) {
    let hist = []; const served = [];
    for (let w = 0; w < 4; w += 1) {
      const monday = addDays(MONDAY, 7 * w);
      const { plan: pw } = gen({ members: fam, seed: `${seed}-${w}`, mondayIso: monday, history: hist });
      hist = [...hist, ...historyRowsOf(pw)];
      const wk = pw.slots.filter((x) => x.meal === 'breakfast' && x.kind === 'cook').map((x) => ({ date: x.date, id: x.items[0]?.recipeId })).filter((x) => x.id);
      slots += wk.length; served.push(...wk);
      const c = {}; for (const x of wk) c[x.id] = (c[x.id] ?? 0) + 1;
      worstWeek = Math.max(worstWeek, ...Object.values(c));
    }
    const last = new Map();
    for (const x of served) { if (last.has(x.id) && daysBetween(last.get(x.id), x.date) <= 7) within7 += 1; last.set(x.id, x.date); }
  }
  eq(slots, 112, '（母體）4 組種子 × 4 週 × 7 天 ＝ 112 個早餐');
  ok(within7 / slots <= WITHIN7_MAX, `同一道早餐 7 天內再出現 ${(100 * within7 / slots).toFixed(1)}%（≤ ${100 * WITHIN7_MAX}%；原本 14%）`);
  ok(worstWeek <= 2, `同一週同一道最多 ${worstWeek} 次（≤ 2）`);
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

section('一週平衡：哪些主菜算「比較豐盛」（同一類菜的相對位置，不是營養上限）');
// 使用者 2026-09-14 原話：「可以多加一些稍微沒那麼健康的料理並用其他天中和回來」。確認的方案：
// 同類菜前四分之一算豐盛、午晚餐主菜一週配額（豐盛 4／油炸 1／加工醃漬 1／紅肉 5）、家人頁少 2／適中 4／多 6、
// 有留意項目的家人相關的菜算兩道。**全部是加減分，不排除**；菜單要維持變化，不能被壓回清淡單調。
const B_MEMBERS = {
  none: [],
  hypertension: [{ ...newMember(), name: '爸', diet: 'omni', conditions: ['hypertension'] }],
  kidneyNoSodium: [{ ...newMember(), name: '阿公', diet: 'omni', conditions: ['kidney'], kidneyWatch: ['phosphorus'] }],
  lactoOvo: [{ ...newMember(), name: '爸', diet: 'omni' }, { ...newMember(), name: '媽', diet: 'lactoOvo' }],
  vegan: [{ ...newMember(), name: '爸', diet: 'omni' }, { ...newMember(), name: '媽', diet: 'vegan' }],
};
{
  const ctx0 = buildContext({ recipes, members: [], idx, units });
  const mains = recipes.filter((r) => r.role === 'main');
  const hearty = mains.filter((r) => ctx0.heartyOf(r).hearty);
  const tagged = (r) => r.method === 'deepfry' || r.tags.includes('processed') || r.tags.includes('sweet');
  const richOnly = hearty.filter((r) => !tagged(r));
  ok(mains.length >= 100, `（母體）主菜 ${mains.length} 道`);
  eq(HEARTY_TOP_SHARE, 0.25, '（前提）豐盛的門檻是前四分之一');
  // 量餘裕：熱量、鈉、飽和脂肪「合起來」排前四分之一 → 約 25%；不是「任一項前四分之一」（那樣會到一半，配額會把菜單壓回清淡）
  ok(richOnly.length / mains.length >= 0.2 && richOnly.length / mains.length <= 0.3, `只因為熱量／鈉／飽和脂肪合起來偏高而算豐盛的主菜 ${richOnly.length}/${mains.length}（${Math.round(richOnly.length / mains.length * 100)}%，在 20–30%）`);
  ok(hearty.length / mains.length <= 0.4, `全部算豐盛的主菜 ${hearty.length}/${mains.length}（${Math.round(hearty.length / mains.length * 100)}% ≤ 40%，含油炸、加工醃漬、含精緻糖）`);
  everyOf(mains.filter(tagged), (r) => ctx0.heartyOf(r).hearty, '油炸、加工肉或醃漬、含精緻糖的主菜一律算豐盛');
  everyOf(hearty, (r) => ctx0.heartyOf(r).why.length >= 1, '每一道豐盛的主菜都講得出為什麼');
  everyOf(hearty, (r) => ctx0.heartyOf(r).weight === 1, '沒有家人留意任何項目 → 每道都算一道');
  everyOf(recipes.filter((r) => r.role !== 'main'), (r) => !ctx0.heartyOf(r).hearty, '只有主菜會被算進豐盛的配額');

  const ctxH = buildContext({ recipes, members: B_MEMBERS.hypertension, idx, units });
  const naHigh = hearty.filter((r) => ctxH.heartyOf(r).hearty && ctxH.heartyOf(r).high.includes('sodium'));
  ok(naHigh.length >= 5, `（母體）估每份鈉在主菜裡偏高的豐盛菜 ${naHigh.length} 道`);
  everyOf(mains.filter((r) => ctxH.heartyOf(r).hearty), (r) => ctxH.heartyOf(r).weight === (ctxH.heartyOf(r).high.includes('sodium') ? 2 : 1), '家裡有人留意鈉：鈉偏高的豐盛菜算兩道，其他照舊算一道');
  const ctxK = buildContext({ recipes, members: B_MEMBERS.kidneyNoSodium, idx, units });
  eq(mains.map((r) => ctxK.heartyOf(r).weight), mains.map((r) => ctx0.heartyOf(r).weight), '腎臟病沒勾「鈉」→ 每道的算法跟沒有家人時一模一樣（不自動限制）');
}

section('一週平衡：配額、分散、上一餐豐盛就傾向清淡（跟「沒平衡」的對照比）');
const bRun = (members, rules, weeks = 8, pre = 'bal') => {
  const ctx = buildContext({ recipes, members, idx, units, rules });
  let history = [];
  const out = { weeks: [], reasons: [], lh: 0, lhL: 0, ln: 0, lnL: 0, mains: new Set(), dishes: new Set(), empty: 0 };
  for (let w = 0; w < weeks; w += 1) {
    const monday = addDays(MONDAY, 7 * w);
    const { plan, diagnostics } = generateWeek({ recipes, members, idx, units, rules, favorites: [], history, mondayIso: monday, seed: `${pre}${w}`, shoppingDays: [3, 6] });
    history = [...history, ...historyRowsOf(plan)];
    const b = weekBalance({ plan, recipes, members, idx, units, rules });
    // 混合家庭每餐會多一道純葷加菜（SPEC_排菜葷素比例）。配額是給正規主菜設計的，
    // 所以另外算一份「不含加菜」的平衡；加菜本身照樣算進 b（上面那一份），兩份都留著比對。
    const planNoExtra = { ...plan, slots: plan.slots.map((sl) => ({ ...sl, items: (sl.items ?? []).filter((it) => !it.extraMeat) })) };
    const bNoExtra = weekBalance({ plan: planNoExtra, recipes, members, idx, units, rules });
    const perDay = new Map();
    for (const x of bNoExtra.hearty) perDay.set(x.day, (perDay.get(x.day) ?? 0) + 1);
    const naHigh = b.hearty.filter((x) => ctx.heartyOf(byId.get(x.recipeId)).high.includes('sodium')).length;
    out.weeks.push({ plan, b, bNoExtra, doubleDays: [...perDay.values()].filter((n) => n > 1).length, weekend: b.hearty.filter((x) => x.day >= 5).length, naHigh });
    const seq = cookSlots(plan).filter((sl) => sl.meal !== 'breakfast').map((sl) => sl.items.find((it) => it.role === 'main')).filter(Boolean);
    for (let i = 1; i < seq.length; i += 1) {
      const prevH = ctx.heartyOf(byId.get(seq[i - 1].recipeId)).hearty;
      const light = ctx.isLight(byId.get(seq[i].recipeId));
      if (prevH) { out.lh += 1; if (light) out.lhL += 1; } else { out.ln += 1; if (light) out.lnL += 1; }
    }
    for (const sl of plan.slots) for (const it of sl.items ?? []) { out.reasons.push(...(it.reasons ?? [])); out.dishes.add(it.recipeId); if (it.role === 'main') out.mains.add(it.recipeId); }
    out.empty += diagnostics.empty.length;
  }
  return out;
};
const bOn = bRun([], { heartyLevel: 'medium' });
const bOff = bRun([], { heartyLevel: 'medium', balance: false });
{
  const W = bOn.weeks;
  ok(bOff.weeks.some((x) => x.b.load > 4), `（對照）同樣的種子不做平衡時，有幾週豐盛超過 4 道（最多 ${Math.max(...bOff.weeks.map((x) => x.b.load))} 道）—— 配額真的有在做事`);
  everyOf(W, (x) => x.b.load <= HEARTY_LEVELS.medium, `適中：每週豐盛的主菜 ≤ 4 道（${W.map((x) => x.b.load).join(' ')}）`);
  everyOf(W, (x) => x.b.hearty.length >= 2, `而且每週至少 2 道 —— 平衡不是把豐盛的菜拿掉、壓回清淡單調（最少 ${Math.min(...W.map((x) => x.b.hearty.length))} 道）`);
  ok(bOff.weeks.reduce((n, x) => n + x.doubleDays, 0) > 0, `（對照）不做平衡時有 ${bOff.weeks.reduce((n, x) => n + x.doubleDays, 0)} 天是午晚餐都豐盛`);
  eq(W.reduce((n, x) => n + x.doubleDays, 0), 0, '做平衡：沒有任何一天午晚餐都是豐盛的主菜');
  ok(Math.max(...bOff.weeks.map((x) => x.b.redMeat)) > WEEK_CAPS.redMeat, `（對照）不做平衡時紅肉主菜最多一週 ${Math.max(...bOff.weeks.map((x) => x.b.redMeat))} 道`);
  everyOf(W, (x) => x.b.redMeat <= WEEK_CAPS.redMeat && x.b.fried <= WEEK_CAPS.fried && x.b.processed <= WEEK_CAPS.processed, `做平衡：每週紅肉 ≤ 5、油炸 ≤ 1、加工醃漬 ≤ 1（紅肉 ${W.map((x) => x.b.redMeat).join(' ')}）`);
  const rateOn = bOn.lhL / bOn.lh; const rateOnNon = bOn.lnL / bOn.ln; const rateOff = bOff.lhL / bOff.lh;
  ok(bOn.lh >= 16, `（母體）${bOn.lh} 次「上一餐豐盛」`);
  ok(rateOn >= 0.4 && rateOn >= 2 * rateOnNon, `上一餐豐盛之後，這一餐的主菜清淡的比例 ${Math.round(rateOn * 100)}%（≥ 40%，而且是上一餐不豐盛時 ${Math.round(rateOnNon * 100)}% 的兩倍以上）`);
  ok(rateOff < rateOn - 0.2, `（對照）不做平衡時只有 ${Math.round(rateOff * 100)}%`);
  // 「變化沒有被壓掉」是統計量：單一組種子下「全部的菜」的比例在 0.93～1.01 之間跳（2026-09-18 補早餐後量了六組，
  // 三組低於舊門檻 95% —— 舊門檻是剛好碰上運氣好的種子，不是平衡把變化壓掉了；早餐根本不吃平衡的加減分）。
  // 改成四組種子合計再比，雜訊小一半；門檻照合計實測（主菜約 92%、全部約 95%）各留約 5 個百分點。
  const pool = ['bal', 'x', 'q', 'w'].map((pre) => (pre === 'bal' ? [bOn, bOff] : [bRun([], { heartyLevel: 'medium' }, 8, pre), bRun([], { heartyLevel: 'medium', balance: false }, 8, pre)]));
  const sum = (k, i) => pool.reduce((n, pair) => n + pair[i][k].size, 0);
  const [mOn, mOff, dOn, dOff] = [sum('mains', 0), sum('mains', 1), sum('dishes', 0), sum('dishes', 1)];
  ok(mOn >= 0.87 * mOff, `變化沒有被壓掉：四組各 8 週，不同的主菜合計 ${mOn}（不做平衡 ${mOff}，${Math.round(mOn / mOff * 100)}%，≥ 87%）`);
  ok(dOn >= 0.9 * dOff, `全部的菜合計 ${dOn} 道次不同（不做平衡 ${dOff}，${Math.round(dOn / dOff * 100)}%，≥ 90%）`);
  eq(bOn.empty, 0, '做平衡不會排出空格（是加減分，不是排除）');
  const hi = bRun([], { heartyLevel: 'high' }); const lo = bRun([], { heartyLevel: 'low' });
  const avgN = (o) => o.weeks.reduce((n, x) => n + x.b.hearty.length, 0) / o.weeks.length;
  everyOf(lo.weeks, (x) => x.b.load <= HEARTY_LEVELS.low && x.b.hearty.length >= 1, `少：每週 1–2 道（${lo.weeks.map((x) => x.b.hearty.length).join(' ')}）`);
  ok(lo.weeks.filter((x) => x.weekend >= 1).length >= lo.weeks.length / 2, `少：一半以上的週末排得到一道豐盛的菜（${lo.weeks.filter((x) => x.weekend >= 1).length}/${lo.weeks.length} 週；燉的菜只排得進週末）`);
  everyOf(hi.weeks, (x) => x.b.load <= HEARTY_LEVELS.high, '多：每週 ≤ 6 道');
  ok(avgN(hi) > avgN(bOn) + 1 && avgN(bOn) > avgN(lo) + 1, `三段真的有差：多 ${avgN(hi).toFixed(1)}、適中 ${avgN(bOn).toFixed(1)}、少 ${avgN(lo).toFixed(1)} 道／週`);
}

section('一週平衡：有留意項目、有素食成員的家庭');
{
  const hyp = bRun(B_MEMBERS.hypertension, {});
  everyOf(hyp.weeks, (x) => x.b.load <= HEARTY_LEVELS.medium && x.naHigh <= 2, `家裡有人留意鈉：每週加權 ≤ 4、鈉偏高的豐盛菜 ≤ 2 道（${hyp.weeks.map((x) => x.naHigh).join(' ')}）`);
  ok(hyp.weeks.some((x) => x.b.doubled > 0) || hyp.weeks.every((x) => x.naHigh === 0), '（前提）算兩道的情況真的有被排到，或者鈉偏高的菜根本沒排（兩者之一）');
  for (const key of ['lactoOvo', 'vegan']) {
    const on = bRun(B_MEMBERS[key], {}); const off = bRun(B_MEMBERS[key], { balance: false });
    // 2026-09-16 SPEC_排菜葷素比例：混合家庭每個午晚餐多一道純葷加菜，一週的主菜從 14 道變 28 道。
    // 配額看的是正規主菜那一半；加菜也算進 weekBalance（下一條對照），整週的豐盛道數因此會比配額高 —— 那是事實，STATUS 記了數字。
    everyOf(on.weeks, (x) => x.bNoExtra.load <= HEARTY_LEVELS.medium, `${key}：不含加菜的主菜每週豐盛 ≤ 4`);
    ok(on.weeks.some((x) => x.b.load > x.bNoExtra.load),
      `（對照）加菜確實算進一週平衡：含加菜最多 ${Math.max(...on.weeks.map((x) => x.b.load))} 道、不含加菜最多 ${Math.max(...on.weeks.map((x) => x.bNoExtra.load))} 道`);
    ok(on.weeks.reduce((n, x) => n + x.doubleDays, 0) <= 1, `${key}：午晚餐都豐盛的日子 8 週最多 1 天（${on.weeks.reduce((n, x) => n + x.doubleDays, 0)}）`);
    eq(on.empty, 0, `${key}：沒有空格（素食保障照舊，平衡只是加減分）`);
    const avgRed = (o) => o.weeks.reduce((n, x) => n + x.b.redMeat, 0) / o.weeks.length;
    ok(avgRed(on) <= avgRed(off), `${key}：紅肉主菜平均 ${avgRed(on).toFixed(1)} 道／週，不比沒平衡（${avgRed(off).toFixed(1)}）多 —— 可分素葷的葷菜多半是豬肉，壓不到 5，本週頁會照講`);
  }
}

section('一週平衡：是加減分不是排除（主菜只剩一定算豐盛的菜，也照樣排得出來）');
{
  // 豐盛是相對於傳進去的池子算的，所以這裡只留「不管池子怎麼變都算豐盛」的主菜：油炸、加工肉或醃漬、含精緻糖。
  const alwaysHearty = (r) => r.method === 'deepfry' || r.tags.includes('processed') || r.tags.includes('sweet');
  const onlyHearty = recipes.filter((r) => r.role !== 'main' || alwaysHearty(r));
  const ctxOnly = buildContext({ recipes: onlyHearty, members: [], idx, units });
  ok(onlyHearty.filter((r) => r.role === 'main').length >= 8, `（前提）主菜只剩 ${onlyHearty.filter((r) => r.role === 'main').length} 道油炸／加工醃漬／含精緻糖的菜`);
  everyOf(onlyHearty.filter((r) => r.role === 'main'), (r) => ctxOnly.heartyOf(r).hearty, '（前提）在這個池子裡它們每一道都算豐盛');
  const { plan } = generateWeek({ recipes: onlyHearty, members: [], idx, units, favorites: [], history: [], mondayIso: MONDAY, seed: 'onlyHearty', shoppingDays: [3, 6] });
  everyOf(cookSlots(plan).filter((sl) => sl.meal !== 'breakfast'), (sl) => sl.items.some((it) => it.role === 'main'), '每個午晚餐照樣有主菜');
  const b = weekBalance({ plan, recipes: onlyHearty, members: [], idx, units });
  ok(b.over > 0, `超過配額 ${b.over} 道 —— 而且摘要會講：「${balanceSentence(b)}」`);
  ok(balanceSentence(b).includes(`比你設定的一週 4 道多了 ${b.over} 道`), '摘要照實講超過幾道');
  ok(!balanceSentence(b).includes('清淡一點平衡'), '超過配額時不會說「前後幾餐排得清淡一點平衡」（那不是真的）');
  ok(balanceSentence({ ...b, over: 0, load: 4, hearty: b.hearty.slice(0, 4) }).includes('清淡一點平衡'), '（對照）沒超過的時候才這樣講');
  ok(cookSlots(plan).flatMap((sl) => sl.items).some((it) => (it.reasons ?? []).some((x) => x.includes('超過一週 4 道的設定'))), '超過的那幾道，理由裡也講了');
}

section('一週平衡：理由與摘要講事實，換過菜也重算');
{
  const W = bOn.weeks;
  const heartyItems = W.flatMap((x) => cookSlots(x.plan).flatMap((sl) => sl.items.filter((it) => it.role === 'main' && x.b.hearty.some((h) => h.recipeId === it.recipeId && h.date === sl.date))));
  ok(heartyItems.length >= 16, `（母體）${heartyItems.length} 道豐盛的主菜`);
  everyOf(heartyItems, (it) => it.reasons.some((x) => x.startsWith('比較豐盛：') && x.includes('這週第')), '每一道豐盛的主菜，理由裡講「比較豐盛：為什麼；這週第幾道」');
  ok(bOn.reasons.filter((x) => x.startsWith('上一餐比較豐盛（')).length >= 8, `「上一餐比較豐盛（菜名），這一餐傾向清淡」出現 ${bOn.reasons.filter((x) => x.startsWith('上一餐比較豐盛（')).length} 次`);

  const { plan, b } = W[0];
  const sentence = balanceSentence(b);
  ok(sentence.includes(`這週有 ${b.hearty.length} 餐的主菜比較豐盛`) && b.hearty.slice(0, 4).every((x) => sentence.includes(x.name.split('／')[0].replace(/（.*?）/g, ''))), `摘要列出這週的豐盛菜：「${sentence}」`);
  // 換成一道不豐盛的 → 摘要從現在的菜單重算，少一道
  const ctx0 = buildContext({ recipes, members: [], idx, units });
  const target = b.hearty[0];
  const si = plan.slots.findIndex((sl) => sl.date === target.date && sl.meal === target.meal);
  const pos = plan.slots[si].items.find((it) => it.recipeId === target.recipeId).pos;
  const light = recipes.find((r) => r.role === 'main' && !ctx0.heartyOf(r).hearty && !cookSlots(plan).some((sl) => sl.items.some((it) => it.recipeId === r.id)));
  const copy = JSON.parse(JSON.stringify(plan));
  assignItem(copy, si, pos, light);
  eq(weekBalance({ plan: copy, recipes, members: [], idx, units }).hearty.length, b.hearty.length - 1, '手動換掉一道豐盛的主菜 → 摘要跟著少一道（從現在的菜單算，不是存下來的舊結果）');

  const variants = [
    balanceSentence({ ...b, hearty: [], load: 0, over: 0 }),
    sentence,
    balanceSentence({ ...b, doubled: 1 }),
    balanceSentence({ ...b, over: 2 }),
    balanceSentence({ ...b, redMeat: 8, fried: 2, processed: 2 }),
  ];
  everyOf(variants, (t) => t.endsWith(BALANCE_NOTE), `每一種摘要最後都帶「${BALANCE_NOTE}」`);
  eq(BALANCE_NOTE, '這是一般飲食常識的安排，不是營養處方。', '（前提）那句說明一字不差');
  ok(variants[4].includes('紅肉（牛、豬）主菜 8 道') && variants[4].includes('油炸的主菜 2 道'), `其他配額超過也照講：「${variants[4]}」`);

  // 禁用詞：理由、摘要、家人頁的說明。除了共用的清單，使用者這次特別點名「健康／降／控制」。
  const BALANCE_WORDS = [...new Set([...FORBIDDEN, '健康', '降', '控制', '改善', '預防'])];
  const hits = (t) => BALANCE_WORDS.filter((w) => t.includes(w));
  ok(hits('排這樣比較健康').length && hits('可以控制血壓').length && hits('幫你降血壓').length, '（對照）判準抓得到「健康」「控制」「降」');
  const hyp = bRun(B_MEMBERS.hypertension, {}, 3);
  const corpus = [...new Set([...bOn.reasons, ...hyp.reasons].filter((x) => /豐盛|清淡|油炸|紅肉|加工|鈉/.test(x))), ...variants, HEARTY_HINT, BALANCE_NOTE];
  ok(corpus.length >= 30, `（母體）${corpus.length} 則平衡相關的理由與摘要`);
  noneOf(corpus, (t) => hits(t).length > 0, '平衡相關的理由、摘要、家人頁說明都沒有療效字眼（含健康／降／控制）', corpus.filter((t) => hits(t).length).slice(0, 3).join('｜'));
}

section('一週平衡：配額以外的扣分（油炸、加工醃漬、紅肉）');
{
  const ctx0 = buildContext({ recipes, members: [], idx, units });
  const fried = recipes.find((r) => r.role === 'main' && r.method === 'deepfry' && r.vegMode === 'meatOnly');
  const processed = recipes.find((r) => r.role === 'main' && r.tags.includes('processed') && r.method !== 'deepfry');
  const red = recipes.find((r) => r.role === 'main' && r.proteins.includes('beef') && !ctx0.heartyOf(r).hearty);
  ok(fried && processed && red, `（前提）挑到油炸 ${fried?.name}、加工醃漬 ${processed?.name}、紅肉 ${red?.name}`);
  const stub = (bal) => ({ slotItems: [], placedWant: new Set(), lastServed: () => null, timesServedWithin: () => 0, dayProteins: () => new Set(), prevDayMealProteins: () => new Set(), fishCount: () => 0, rangeHas: () => false, balance: { load: 0, count: 0, fried: 0, processed: 0, redMeat: 0, ...bal }, heartySlot: () => null, heartyMealsOn: () => [], sodiumHighYesterday: () => false });
  const slot = { role: 'main', meal: 'lunch', date: '2026-09-16', day: 2 };
  const at = (r, bal) => scoreSoft(r, slot, ctx0, stub(bal), () => 0);
  const cases = [['油炸', fried, { fried: 0 }, { fried: WEEK_CAPS.fried }], ['加工醃漬', processed, { processed: 0 }, { processed: WEEK_CAPS.processed }], ['紅肉', red, { redMeat: 0 }, { redMeat: WEEK_CAPS.redMeat }]];
  for (const [label, r, under, full] of cases) {
    const a = at(r, under); const z = at(r, full);
    ok(a.score - z.score >= 30, `${label}：這週的配額滿了之後同一道菜少 ${Math.round(a.score - z.score)} 分（≥ 30）`);
    ok(z.reasons.some((x) => x.startsWith('這週') && x.includes(label === '紅肉' ? '紅肉' : label === '油炸' ? '油炸' : '加工肉或醃漬')), `${label}：理由講出這週已經有幾道`);
  }
  // 同一天另一餐已經豐盛。產生一週時晚餐排在午餐之後，「上一餐豐盛」那條就擋住了 —— 所以只看產生結果的斷言
  // 量不出這條（突變驗證抓到：把它拿掉，整週的斷言照樣綠）。它真正起作用的是「換一道午餐」：那時晚餐已經排好了。
  const sameDayMain = recipes.find((r) => r.role === 'main' && ctx0.heartyOf(r).hearty && !r.proteins.some((p) => p === 'beef' || p === 'pork') && r.method !== 'deepfry' && !r.tags.includes('processed'));
  ok(sameDayMain, `（前提）挑一道豐盛、但不牽涉其他配額的主菜：${sameDayMain?.name}`);
  const withDay = (meals) => ({ ...stub({}), heartyMealsOn: () => meals });
  const free = scoreSoft(sameDayMain, slot, ctx0, withDay([]), () => 0);
  const busy = scoreSoft(sameDayMain, slot, ctx0, withDay(['dinner']), () => 0);
  ok(free.score - busy.score >= 25, `同一天晚餐已經豐盛 → 午餐這道豐盛的菜少 ${Math.round(free.score - busy.score)} 分（≥ 25）；換一道午餐時靠這條避開同一天兩餐都豐盛`);
  ok(busy.reasons.includes('今天晚餐已經比較豐盛'), '理由講「今天晚餐已經比較豐盛」');
}

section('本週想吃：一定要排到（重新產生幾次都一樣），排不進去要講原因');
{
  // 2026-09-14 使用者回報：勾了「本週想吃」的滷雞腳，重新產生幾次都沒排進去。
  // 實測根因：訊號有傳進排菜器（wantSet 有它），但家裡有素食成員時純葷的菜在一般位置一定被飲食型態擋下，
  // 唯一的「給吃葷的人的加菜」只在主菜排不到葷時才開 —— 12 次產生 0 次排進去，而且沒有任何提示。
  const M = (o) => ({ ...newMember(), ...o });
  const mixedHome = [M({ name: '爸', diet: 'omni' }), M({ name: '媽', diet: 'lactoOvo' })];
  const feet = { ...recipes.find((r) => r.role === 'main' && r.vegMode === 'meatOnly' && r.time <= 30), id: 'r-user-feet', name: '滷雞腳', time: 0, source: 'user' };
  const pool = [...recipes, feet];
  const wantFeet = [{ recipeId: feet.id, wantThisWeek: true, favorite: false }];
  const runs = [];
  for (let i = 0; i < 8; i += 1) {
    const { plan, diagnostics } = generateWeek({ recipes: pool, members: mixedHome, idx, units, favorites: wantFeet, history: [], mondayIso: addDays(MONDAY, 7 * i), seed: `want${i}`, shoppingDays: [1, 4] });
    const hits = cookSlots(plan).flatMap((s) => s.items.filter((it) => it.recipeId === feet.id).map((it) => ({ ...it, meal: s.meal, ids: s.items.map((x) => x.recipeId) })));
    runs.push({ hits, missed: diagnostics.wantMissed });
  }
  everyOf(runs, (x) => x.hits.length === 1, `家裡有蛋奶素的媽，勾了純葷的滷雞腳：8 次產生每次都排進去剛好一次（${runs.map((x) => x.hits.length).join('、')}）`);
  everyOf(runs.flatMap((x) => x.hits), (it) => it.extraMeat === true && it.reasons.includes('你勾了「本週想吃」'), '排在「給吃葷的人的加菜」，理由寫「你勾了「本週想吃」」');
  everyOf(runs.flatMap((x) => x.hits), (it) => it.ids.filter((id) => { const r = id === feet.id ? feet : byId.get(id); return r && versionFor(r, 'lactoOvo') !== null; }).length >= VEG_MIN_DISHES,
    `那一餐媽照樣吃得到至少 ${VEG_MIN_DISHES} 道（素食保障沒有被擠掉）`);
  everyOf(runs, (x) => x.missed.length === 0, '排進去了就不會記在「沒排進去」');
  const noWant = generateWeek({ recipes: pool, members: mixedHome, idx, units, favorites: [], history: [], mondayIso: MONDAY, seed: 'want0', shoppingDays: [1, 4] });
  ok(!cookSlots(noWant.plan).some((s) => s.items.some((it) => it.recipeId === feet.id)), '（對照）沒勾本週想吃，這道純葷的菜不會出現在有素食成員的家');

  // 蓋得過扣分：3 天前才吃過（14 天不重複 -100）
  const again = recipes.find((r) => r.role === 'main' && r.vegMode === 'splittable' && r.time <= 30);
  const againRuns = [0, 1, 2, 3].map((i) => generateWeek({ recipes, members: [], idx, units, favorites: [{ recipeId: again.id, wantThisWeek: true }],
    history: [{ recipeId: again.id, date: addDays(MONDAY, -3) }], mondayIso: MONDAY, seed: `again${i}`, shoppingDays: [1, 4] }));
  everyOf(againRuns, (run) => mainsOf(run.plan).some((m) => m.recipeId === again.id), `3 天前才吃過的「${again.name}」勾了本週想吃：照樣排進去（以前 +40 分蓋不過不重複的 -100）`);
  const againItem = mainsOf(againRuns[0].plan).find((m) => m.recipeId === again.id);
  ok((againItem?.reasons ?? []).some((t) => t.includes('你勾了「本週想吃」，照樣排')), `重複的理由講是你要排的：「${(againItem?.reasons ?? []).find((t) => t.startsWith('上次是'))}」`);
  noneOf(againItem?.reasons ?? [], (t) => t.includes('因為符合條件的菜不夠'), '不是「因為符合條件的菜不夠」');
  everyOf(againRuns, (run) => !run.diagnostics.forcedRepeats.some((x) => x.recipeId === again.id), '也不算進「勉強重複」的診斷');

  // 全家吃葷，勾了素的主菜：以前「這一餐要有葷」會先把它擋掉
  const vegMain = recipes.find((r) => r.role === 'main' && r.vegMode === 'nativeVeg' && r.time <= 30);
  const vegRuns = [0, 1, 2].map((i) => gen({ favorites: [{ recipeId: vegMain.id, wantThisWeek: true }], seed: `vegwant${i}`, shoppingDays: [1, 4] }));
  everyOf(vegRuns, (run) => mainsOf(run.plan).some((m) => m.recipeId === vegMain.id), `全家吃葷，勾了素的主菜「${vegMain.name}」也排得進來`);
  everyOf(vegRuns.map((run) => cookSlots(run.plan).find((s) => s.items.some((it) => it.recipeId === vegMain.id))), (s) => !!s && s.items.some((it) => isMeaty(byId.get(it.recipeId))),
    '那一餐還是有一道葷的（加菜補上）');

  // 真的排不進去：照實講原因
  const slow = { ...feet, id: 'r-user-slow', name: '慢燉牛腱', time: 300 };
  const slowRun = generateWeek({ recipes: [...recipes, slow], members: [], idx, units, favorites: [{ recipeId: slow.id, wantThisWeek: true }], history: [], mondayIso: MONDAY, seed: 'slow', shoppingDays: [1, 4] });
  ok(!mainsOf(slowRun.plan).some((m) => m.recipeId === slow.id), '（前提）要 300 分鐘的菜，每一餐都超過時間上限，排不進去');
  eq(slowRun.diagnostics.wantMissed.map((x) => x.recipeId), [slow.id], '沒排進去 → 記在 diagnostics.wantMissed，不靜默');
  ok(/300 分鐘.*時間上限/.test(slowRun.diagnostics.wantMissed[0]?.why ?? ''), `原因講實際擋住的那一條：「${slowRun.diagnostics.wantMissed[0]?.why}」`);
  const vegHome = generateWeek({ recipes: pool, members: [M({ name: '媽', diet: 'lactoOvo' })], idx, units, favorites: wantFeet, history: [], mondayIso: MONDAY, seed: 'allveg', shoppingDays: [1, 4] });
  const vegWhy = vegHome.diagnostics.wantMissed[0]?.why ?? '';
  ok(vegWhy.includes('只有吃葷的人能吃') && vegWhy.includes('媽'), `全家吃素、勾了純葷的菜：原因講「${vegWhy}」`);
  noneOf([slowRun.diagnostics.wantMissed[0]?.why ?? '', vegWhy], (t) => ['健康', '降', '控制', '療效', '治療'].some((w) => t.includes(w)), '原因裡沒有禁用詞');

  // 只勾本週想吃不算收藏（兩個開關各自獨立）
  const onlyWant = buildContext({ recipes, members: [], idx, units, favorites: [{ recipeId: again.id, wantThisWeek: true, favorite: false }, { recipeId: vegMain.id, wantThisWeek: false }] });
  ok(!onlyWant.favSet.has(again.id) && onlyWant.wantSet.has(again.id), '只勾本週想吃、沒按收藏：排菜器不當成收藏');
  ok(onlyWant.favSet.has(vegMain.id), '（對照）舊資料沒有 favorite 欄位 → 照舊算收藏');
}

section('每日估算分組：數字一樣的成員併一組，不一樣的分開');
{
  // 使用者 2026-09-16：吃葷的家人每人各列一份、數字完全相同 —— 重複又佔版面。
  // 併的條件是數字完全一致，所以「分類正確才併」是由結構保證的，不是靠飲食型態硬併。
  const F = ['kcal', 'protein'];
  const row = (label, diet, kcal, protein, extra = {}) => ({ label, diet, fields: { kcal, protein }, missing: 0, ...extra });
  const same = groupEstimates([
    row('爺爺', 'omni', 1800, 70), row('爸爸', 'omni', 1800, 70), row('媽媽', 'omni', 1800, 70),
    row('奶奶', 'lactoOvo', 1500, 55),
  ], F);
  eq(same.length, 2, '三位吃葷的數字一樣 → 併成一組；蛋奶素的自己一組');
  eq(same[0].labels, ['爺爺', '爸爸', '媽媽'], '第一組列出三位成員');
  eq(same[0].diets, ['omni'], '第一組是葷');
  eq(same[0].fields, { kcal: 1800, protein: 70 }, '共用同一份估算（沒有相加）');
  eq(same[1].labels, ['奶奶'], '第二組是蛋奶素的奶奶');
  const diff = groupEstimates([
    row('爸爸', 'omni', 1800, 70), row('哥哥', 'omni', 1801, 70),
  ], F);
  eq(diff.length, 2, '（對照）同樣吃葷但數字差 1 → 不會併');
  const missing = groupEstimates([
    row('爸爸', 'omni', 1800, 70), row('哥哥', 'omni', 1800, 70, { missing: 2 }),
  ], F);
  eq(missing.length, 2, '數字一樣、但「吃不了的道數」不同 → 也分開（那是兩件不一樣的事實）');
  const partial = groupEstimates([
    row('爸爸', 'omni', 1800, 70), row('哥哥', 'omni', 1800, 70, { partialDishes: 1 }),
  ], F);
  eq(partial.length, 2, '部分估算的道數不同 → 也分開（不可以把「只是部分估算」藏起來）');
  const mixedDiet = groupEstimates([
    row('姊', 'vegan', 1400, 48), row('妹', 'veganNoAllium', 1400, 48),
  ], F);
  eq(mixedDiet.length, 1, '五辛素與全素這一天吃到的數字一樣 → 併成一組');
  eq(mixedDiet[0].diets, ['vegan', 'veganNoAllium'], '而且兩種飲食型態都列出來，不會只寫其中一種');
}

section('排菜葷素比例：加菜那天的每日估算，素食成員吃不了的道數＝有加菜的餐數');
{
  // 加菜是「只有吃葷的人吃」的菜，所以素食成員那一天的估算不含它，而且畫面要講得出「有 N 道這位吃不了」。
  const dad = { ...newMember(), name: '爸', diet: 'omni' };
  const mom = { ...newMember(), name: '媽', diet: 'lactoOvo' };
  const { plan: mp } = gen({ members: [dad, mom], seed: 'est-extra' });
  const day0 = mp.slots.filter((s) => s.day === 0);
  const extrasDay0 = day0.flatMap((s) => (s.items ?? []).filter((it) => it.extraMeat)).length;
  ok(extrasDay0 >= 1, `（前提）第一天有 ${extrasDay0} 道加菜`);
  const rows = dailyEstimates(day0, [dad, mom], idx, byId, ['kcal', 'protein']);
  const momRow = rows.find((r) => r.label === '媽');
  const dadRow = rows.find((r) => r.label === '爸');
  eq(momRow.missing, extrasDay0, `媽那天吃不了的道數＝加菜數（${momRow.missing}）`);
  eq(dadRow.missing, 0, '爸什麼都吃得到');
  ok(dadRow.fields.kcal > momRow.fields.kcal, `爸的估計值比媽高（多了加菜那幾道）：${Math.round(dadRow.fields.kcal)} vs ${Math.round(momRow.fields.kcal)}`);
}

section('排菜葷素比例：混合家庭每個午晚餐放一道純葷加菜（SPEC_排菜葷素比例）');
{
  // Yolin 原話：「午餐、晚餐在素食有 2 道菜以上的情況下，可以有幾道是葷食；不然像滷雞腳這類無法分流的葷菜永遠排不進去。」
  // 定案是「每餐都放、沒有配額」，唯一硬門檻是素食保障（每位素食成員仍吃得到 VEG_MIN_DISHES 道，含主食）。
  const mixed = [{ ...newMember(), name: '爸', diet: 'omni' }, { ...newMember(), name: '媽', diet: 'lactoOvo' }];
  const SEEDS8 = ['x1', 'x2', 'x3', 'x4', 'x5', 'x6', 'x7', 'x8'];
  const runs = SEEDS8.map((seed) => gen({ members: mixed, seed }));
  const meals = runs.flatMap((r) => cookSlots(r.plan).filter((s) => s.meal !== 'breakfast'));
  const extrasOf = (s) => s.items.filter((it) => it.extraMeat);

  // P1
  eq(meals.length, 112, `（母體）8 週共 ${meals.length} 個午晚餐`);
  const withExtra = meals.filter((s) => extrasOf(s).length > 0);
  ok(withExtra.length >= 90, `有加菜的 ${withExtra.length}／${meals.length} 餐 —— 量的是餘裕，門檻 90 不是「> 0」（慣例 22）`);
  everyOf(meals, (s) => extrasOf(s).length <= 1, '一餐最多一道加菜');
  const extras = meals.flatMap((s) => extrasOf(s).map((it) => ({ it, meal: s.meal })));
  everyOf(extras, (x) => byId.get(x.it.recipeId).vegMode === 'meatOnly', '加菜都是純葷的菜');
  everyOf(extras, (x) => x.it.role === 'main', '加菜的角色是主菜（它取代一道配菜的位置）');
  everyOf(extras, (x) => x.it.pos === MEAL_ROLES[x.meal].lastIndexOf('side'), '加菜佔的是最後一道配菜的位置');
  everyOf(extras, (x) => x.it.reasons.some((t) => t.includes('加菜')), '理由講明它是加菜');
  const skipped = runs.flatMap((r) => r.diagnostics.meatExtraSkipped);
  eq(skipped.length, meals.length - withExtra.length, `沒放加菜的 ${meals.length - withExtra.length} 餐，每一餐都記在 meatExtraSkipped`);
  everyOf(skipped, (x) => ['vegGuarantee', 'noCandidate'].includes(x.why), '不放的原因只有素食保障或挑不到兩種');

  // P2 素食保障（母體現在幾乎每餐都含加菜）
  const vegCounts = meals.map((s) => s.items.filter((it) => versionFor(byId.get(it.recipeId), 'lactoOvo') !== null).length);
  everyOf(vegCounts, (n) => n >= VEG_MIN_DISHES, `每個午晚餐媽仍吃得到 ≥ ${VEG_MIN_DISHES} 道（最少 ${Math.min(...vegCounts)} 道）`);

  // P3 對照：全葷、全素、沒有家人都不放加菜
  const omniFam = [{ ...newMember(), name: 'a' }, { ...newMember(), name: 'b' }, { ...newMember(), name: 'c' }];
  const omniRun = gen({ members: omniFam });
  const omniExtras = cookSlots(omniRun.plan).flatMap((s) => s.items.filter((it) => it.extraMeat));
  ok(cookSlots(omniRun.plan).flatMap((s) => s.items).filter((it) => byId.get(it.recipeId).vegMode === 'meatOnly').length >= 5,
    `（對照母體）全葷家庭本來就吃得到純葷主菜 ${cookSlots(omniRun.plan).flatMap((s) => s.items).filter((it) => byId.get(it.recipeId).vegMode === 'meatOnly').length} 道`);
  eq(omniExtras.length, 0, '全葷家庭不放加菜（純葷菜直接當主菜就好）');
  eq(omniRun.diagnostics.meatExtraSkipped.length, 0, '全葷家庭也不會記 meatExtraSkipped');
  const vegFam2 = [{ ...newMember(), name: '姊', diet: 'vegan' }, { ...newMember(), name: '妹', diet: 'veganNoAllium' }];
  const vegRun = gen({ members: vegFam2 });
  noneOf(cookSlots(vegRun.plan).flatMap((s) => s.items), (it) => byId.get(it.recipeId).vegMode === 'meatOnly', '全素家庭一道純葷的都沒有（紅線）');
  eq(cookSlots(gen({}).plan).flatMap((s) => s.items).filter((it) => it.extraMeat).length, 0, '還沒新增家人 → 不放加菜');

  // P4 合成池：可分流主菜只剩「什錦炒米粉」（本身含主食）→ 午餐素食成員只剩 2 道，放不了加菜；晚餐多一道湯，放得下
  const noodle = recipes.find((r) => r.vegMode === 'splittable' && r.includesStaple);
  ok(noodle, `（前提）挑到一道本身含主食的可分流主菜：${noodle?.name}`);
  const meatMains2 = recipes.filter((r) => r.role === 'main' && r.vegMode === 'meatOnly');
  const pool4 = [noodle, ...meatMains2, ...recipes.filter((r) => r.role !== 'main')];
  const run4 = gen({ members: mixed, recipes: pool4, seed: 'noodle' });
  const lunches = cookSlots(run4.plan).filter((s) => s.meal === 'lunch');
  const dinners = cookSlots(run4.plan).filter((s) => s.meal === 'dinner');
  eq(lunches.filter((s) => extrasOf(s).length).length, 0, '主菜本身含主食的午餐：素食成員只剩 2 道 → 不放加菜');
  ok(dinners.filter((s) => extrasOf(s).length).length >= 5, `同一週的晚餐多一道湯 → ${dinners.filter((s) => extrasOf(s).length).length}／7 餐放得下加菜`);
  ok(run4.diagnostics.meatExtraSkipped.filter((x) => x.why === 'vegGuarantee').length >= 7,
    `午餐沒放的原因都是素食保障（${run4.diagnostics.meatExtraSkipped.filter((x) => x.why === 'vegGuarantee').length} 筆）`);

  // P5 純葷池砍到 5 道 → 加菜會在 14 天內重複，而且要照實記進 forcedRepeats
  const pool5 = [...recipes.filter((r) => r.vegMode !== 'meatOnly'), ...meatMains2.slice(0, 5)];
  const run5 = gen({ members: mixed, recipes: pool5, seed: 'tiny-meat' });
  const extras5 = cookSlots(run5.plan).flatMap((s) => s.items.filter((it) => it.extraMeat));
  ok(extras5.length >= 10, `（前提）這一週有 ${extras5.length} 道加菜，池子只有 5 道純葷主菜`);
  const repeatExtras = run5.diagnostics.forcedRepeats.filter((x) => byId.get(x.recipeId)?.vegMode === 'meatOnly');
  ok(repeatExtras.length >= 5, `加菜的重複照實記進「勉強排的」診斷：${repeatExtras.length} 筆`);
  everyOf(repeatExtras, (x) => x.role === 'main', '記的角色是主菜');

  // P6 時間上限壓到 15 分鐘 → 放寬時間的加菜要進 relaxed
  const tight = { timeCaps: { weekday: { breakfast: 15, lunch: 15, dinner: 15 }, weekend: { breakfast: 15, lunch: 15, dinner: 15 } } };
  const run6 = gen({ members: mixed, rules: tight, seed: 'tight' });
  const extras6 = cookSlots(run6.plan).flatMap((s) => s.items.filter((it) => it.extraMeat));
  ok(extras6.length >= 5, `（前提）時間上限 15 分鐘時仍放了 ${extras6.length} 道加菜`);
  const relaxedIds = new Set(run6.diagnostics.relaxed.filter((x) => x.constraints.includes('relaxTime')).map((x) => x.recipeId));
  const overTime = extras6.filter((it) => byId.get(it.recipeId).time > 15);
  // 兩種情況都要有斷言：有超時的就要記 relaxTime；沒有超時的就代表全部都在上限內（空集合不算通過）。
  if (overTime.length) {
    everyOf(overTime, (it) => relaxedIds.has(it.recipeId), `超過 15 分鐘的加菜都記了 relaxTime（${overTime.length} 道）`);
  } else {
    everyOf(extras6, (it) => byId.get(it.recipeId).time <= 15, `時間上限壓到 15 分鐘時，${extras6.length} 道加菜全部都在上限內（沒有放寬）`);
  }

  // P7 本週想吃的純葷菜：一定排到，而且那一餐不會有第二道純葷
  const feetWant = { ...meatMains2[0], id: 'r-user-feet-spec', name: '滷雞腳', time: 0, source: 'user' };
  const run7 = gen({ members: mixed, recipes: [...recipes, feetWant], favorites: [{ recipeId: feetWant.id, wantThisWeek: true }], seed: 'want-extra' });
  const feetSlots = cookSlots(run7.plan).filter((s) => s.items.some((it) => it.recipeId === feetWant.id));
  eq(feetSlots.length, 1, '勾了本週想吃的滷雞腳排進去剛好一次');
  eq(extrasOf(feetSlots[0]).length, 1, '那一餐只有一道加菜（就是滷雞腳，沒有第二道純葷）');
  eq(extrasOf(feetSlots[0])[0].recipeId, feetWant.id, '而且那一道就是它');

  // P9 一週平衡要把加菜算進去
  const bal = weekBalance({ plan: runs[0].plan, recipes, members: mixed, idx, units, rules: {} });
  const extraIds = new Set(cookSlots(runs[0].plan).flatMap((s) => s.items.filter((it) => it.extraMeat).map((it) => it.recipeId)));
  ok(extraIds.size >= 8, `（母體）第一個種子有 ${extraIds.size} 道不同的加菜`);
  ok(bal.hearty.some((h) => extraIds.has(h.recipeId)) || bal.redMeat > 0,
    `加菜有算進一週平衡（豐盛 ${bal.hearty.length} 道、紅肉 ${bal.redMeat} 道）`);

  // P10 鎖住的加菜重新產生後留著，而且那一餐仍只有一道
  const base10 = runs[0].plan;
  const lockSlot = cookSlots(base10).find((s) => extrasOf(s).length === 1);
  ok(lockSlot, '（前提）找得到一餐有加菜的');
  const locked = JSON.parse(JSON.stringify(base10));
  const li = locked.slots.findIndex((s) => s.day === lockSlot.day && s.meal === lockSlot.meal);
  const lockedId = extrasOf(lockSlot)[0].recipeId;
  for (const it of locked.slots[li].items) if (it.extraMeat) it.locked = true;
  const run10 = gen({ members: mixed, prevPlan: locked, seed: 'relock' });
  const after10 = run10.plan.slots.find((s) => s.day === lockSlot.day && s.meal === lockSlot.meal);
  ok(after10.items.some((it) => it.recipeId === lockedId && it.extraMeat), '鎖住的加菜重新產生後還在');
  eq(after10.items.filter((it) => it.extraMeat).length, 1, '那一餐仍然只有一道加菜');

  // P11 refillSlot：外食改回自己煮，走的是同一條規則（慣例 21）
  const plan11 = JSON.parse(JSON.stringify(runs[1].plan));
  const di = plan11.slots.findIndex((s) => s.kind === 'cook' && s.meal === 'dinner');
  plan11.slots[di].items = [];
  const refilled = refillSlot({ plan: plan11, slotIndex: di, recipes, members: mixed, idx, units, favorites: [], history: [], shoppingDays: [3, 6], seed: 'refill' });
  ok(refilled.items.length >= 4, `重填的晚餐有 ${refilled.items.length} 道`);
  ok(refilled.items.some((it) => isMeaty(byId.get(it.recipeId))), '重填之後那一餐有葷的');
  eq(refilled.items.filter((it) => it.extraMeat).length, 1, '重填的晚餐也放了一道加菜 —— 跟「產生菜單」同一條規則');
  ok(refilled.items.filter((it) => versionFor(byId.get(it.recipeId), 'lactoOvo') !== null).length >= VEG_MIN_DISHES,
    `重填之後媽仍吃得到 ≥ ${VEG_MIN_DISHES} 道`);
  const plan11b = JSON.parse(JSON.stringify(omniRun.plan));
  const di2 = plan11b.slots.findIndex((s) => s.kind === 'cook' && s.meal === 'dinner');
  plan11b.slots[di2].items = [];
  const refilledOmni = refillSlot({ plan: plan11b, slotIndex: di2, recipes, members: omniFam, idx, units, favorites: [], history: [], shoppingDays: [3, 6], seed: 'refill' });
  eq(refilledOmni.items.filter((it) => it.extraMeat).length, 0, '（對照）全葷家庭重填那一餐不會有加菜');

  // P12 全葷家庭：同種子同輸出（這一版沒有動到主亂數串）
  const twiceA = gen({ members: omniFam, seed: 'stable' });
  const twiceB = gen({ members: omniFam, seed: 'stable' });
  eq(JSON.stringify(twiceA.plan.slots), JSON.stringify(twiceB.plan.slots), '全葷家庭同種子同輸出');

  // P14（2026-09-17 使用者回報）本週想吃的純葷菜**填成配菜**時也要排得進加菜格。
  //
  // 根因：加菜格以前只從 role==='main' 的菜裡挑，而滷雞腳、雞翅這類菜使用者多半填成配菜 ——
  // 一般格被飲食型態擋（純葷）、加菜格又不收配菜，於是哪一格都進不去，本週頁只能說「排不進去」。
  // 實測修之前 8 個種子 0 次排進去，理由就是畫面上那句「這道只有吃葷的人能吃，奶奶吃素」。
  const feetSide = {
    ...recipes.find((r) => r.role === 'side' && r.vegMode !== 'meatOnly'),
    id: 'r-user-feet-side', name: '滷雞腳（自己加的配菜）', role: 'side', vegMode: 'meatOnly', time: 30, source: 'user',
    ingredients: [{ food: 'I0420801', label: '雞腳', grams: 400 }],
  };
  const sideWantRuns = SEEDS8.map((seed) => gen({
    members: mixed, recipes: [...recipes, feetSide],
    favorites: [{ recipeId: feetSide.id, wantThisWeek: true }], seed,
  }));
  const placedWeeks = sideWantRuns.filter((r) => cookSlots(r.plan).some((s) => s.items.some((it) => it.recipeId === feetSide.id)));
  // 量餘裕：不綁哪一餐、也不綁哪一週，看的是「8 週裡有幾週排進去」（慣例 22）
  eq(placedWeeks.length, SEEDS8.length, `8 個種子每一週都排進去（${placedWeeks.length}／${SEEDS8.length}）—— 修之前是 0／8`);
  const sidePlacements = sideWantRuns.flatMap((r) => cookSlots(r.plan).flatMap((s) => s.items.filter((it) => it.recipeId === feetSide.id).map((it) => ({ it, s }))));
  everyOf(sidePlacements, (x) => x.it.extraMeat === true, '每一次都是走「加菜（僅葷食成員）」那一格進來的');
  everyOf(sidePlacements, (x) => x.it.role === 'side', '它的角色記成配菜（照那道菜自己的角色，不是硬寫成主菜）');
  everyOf(sidePlacements, (x) => x.s.meal !== 'breakfast', '只會排在午餐或晚餐');
  everyOf(sidePlacements, (x) => x.s.items.filter((it) => it.extraMeat).length === 1, '那一餐仍然只有一道加菜');
  // 紅線：素食成員那一餐照樣吃得到 VEG_MIN_DISHES 道
  const sideVegCounts = sideWantRuns.flatMap((r) => cookSlots(r.plan).filter((s) => s.meal !== 'breakfast'))
    .map((s) => s.items.filter((it) => versionFor(byId.get(it.recipeId) ?? feetSide, 'lactoOvo') !== null).length);
  everyOf(sideVegCounts, (n) => n >= VEG_MIN_DISHES, `媽每一個午晚餐仍吃得到 ≥ ${VEG_MIN_DISHES} 道（最少 ${Math.min(...sideVegCounts)} 道）`);
  // 排進去了就不該再出現「沒排進去」的誠實卡
  eq(sideWantRuns.flatMap((r) => r.diagnostics.wantMissed).filter((w) => w.recipeId === feetSide.id).length, 0,
    '沒有任何一週把它記進 wantMissed（本週頁不會再說「排不進去」）');

  // （對照）沒勾「本週想吃」的純葷配菜**不會**被當成一般加菜排進來 ——
  // 一般的加菜照舊只挑主菜（SPEC_排菜葷素比例），上面那幾條不是因為把整個加菜格放寬了。
  const quietRuns = SEEDS8.map((seed) => gen({ members: mixed, recipes: [...recipes, feetSide], seed }));
  const quietHits = quietRuns.flatMap((r) => cookSlots(r.plan).flatMap((s) => s.items.filter((it) => it.recipeId === feetSide.id)));
  eq(quietHits.length, 0, '（對照）同一道菜沒勾「本週想吃」時，8 週一次都沒被排進來');
  const quietExtras = quietRuns.flatMap((r) => cookSlots(r.plan).flatMap((s) => s.items.filter((it) => it.extraMeat)));
  ok(quietExtras.length >= 80, `（對照母體）那 8 週照樣有 ${quietExtras.length} 道加菜 —— 上面那條不是因為加菜整個壞掉`);
  everyOf(quietExtras, (it) => byId.get(it.recipeId).role === 'main', '（對照）沒勾想吃時，加菜一律還是主菜');
}

done('plannertest');

// 購物清單（npm run shoppingtest）。數量是使用者會實際照著買的，所以逐條手算對照。
//
// 守的事：
//   · 採買區間：週三＋週六 → 週一二歸上週六、週三四五歸週三、週六日歸週六；每個自己煮的日子剛好在一個區間；沒設買菜日 → 一個整週區間
//   · 縮放：共用軌 × 吃得了的人數 ÷ 份數；素鍋 × 吃素版人數 ÷ 素版份數；葷鍋 × 吃葷版人數 ÷ 葷版份數；沒人吃的軌不買；沒有家人照原份量
//   · 同一個食材跨餐加總；常備品另列；外食格不算
//   · 換算：713 g 高麗菜（一顆 1000 g）→ 1 顆；不少買

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ok, eq, near, section, done, everyOf, noneOf, detects } from './tap.mjs';
import { indexFoods } from '../js/foods.js';
import { newMember } from '../js/members.js';
import { planCustomCarry, rangesOfPlan, orderRangesForToday, rangeIsPast, buildShoppingList, scaleFor, suggestedText, manualUnitOf, sanitizeCustom, customKey, sectionOf, quantityText, listAsText, SECTIONS } from '../js/shopping.js';
import { generateWeek } from '../js/planner.js';
import { estimate } from '../js/nutrition.js';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const foods = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/foods.json'), 'utf8'));
const aliases = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/aliases.json'), 'utf8'));
const units = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/units.json'), 'utf8'));
const recipes = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/recipes.json'), 'utf8')).recipes;
const idx = indexFoods(foods, aliases);
const byId = new Map(recipes.map((r) => [r.id, r]));
const MONDAY = '2026-09-14';
const dates = Array.from({ length: 7 }, (_, i) => `2026-09-${14 + i}`);
const slot = (day, meal, items, kind = 'cook') => ({ day, date: dates[day], meal, kind, items: items.map((id, i) => ({ recipeId: id, role: i === 0 ? 'main' : 'side', locked: false, reasons: [] })) });
const plan = (slots) => ({ weekKey: '2026-W38', monday: MONDAY, seed: 't', slots });

const cabbagePork = byId.get('r-cabbage-pork-stirfry');   // splittable：高麗菜 500 base、乾香菇 15 veg、豬肉片 200 meat、油 15 鹽 3 醬油 10 常備
const plainCabbage = byId.get('r-stir-fried-cabbage');    // nativeVeg：高麗菜 450、蒜 10、鹽 3 油 15 常備
const CABBAGE = 'E30001';

section('採買區間');
const p1 = plan(dates.map((_, d) => slot(d, 'dinner', ['r-stir-fried-cabbage'])));
const ranges = rangesOfPlan(p1, [3, 6]);
eq(ranges.map((r) => r.key), ['2026-09-12', '2026-09-16', '2026-09-19'], '週三、週六買菜：三個區間，第一個是上週六');
eq(ranges.map((r) => r.dates), [['2026-09-14', '2026-09-15'], ['2026-09-16', '2026-09-17', '2026-09-18'], ['2026-09-19', '2026-09-20']], '週一二歸上週六、週三四五歸週三、週六日歸週六');
eq(ranges.flatMap((r) => r.dates).sort(), dates, '七天每一天剛好在一個區間（無縫、無重疊）');
ok(ranges[0].label.includes('上週') && ranges[1].label === '9/16（三）買', `標籤：${ranges.map((r) => r.label).join('、')}`);
eq(rangesOfPlan(p1, []).length, 1, '沒設買菜日 → 一個整週區間');
eq(rangesOfPlan(p1, []).at(0).dates, dates, '整週區間包含七天');
const p1eat = plan(dates.map((_, d) => slot(d, 'dinner', ['r-stir-fried-cabbage'], d === 0 ? 'eatOut' : 'cook')));
eq(rangesOfPlan(p1eat, [3, 6])[0].dates, ['2026-09-15'], '外食的那一天不算進區間');

section('買菜頁的順序：還有餐要煮的排前面，整個過去的排後面');
// 使用者回報：星期四打開買菜頁，最上面那張是「上週六買」——三天前該買的、那幾餐也早吃完了，
// 要一直往下捲才看得到現在這一張。判斷「過去了」看的是**它給哪幾餐**，不是買菜日本身：
// 星期三那張的買菜日雖然過了，但它買的正是今天晚上要煮的菜。
{
  // ranges 是上面那組：9/12 買（給 9/14、9/15）、9/16 買（給 9/16–9/18）、9/19 買（給 9/19、9/20）
  eq(ranges.map((r) => rangeIsPast(r, '2026-09-17')), [true, false, false],
    '9/17（四）站在這裡：只有「上週六買」那張整個過去了');
  eq(orderRangesForToday(ranges, '2026-09-17').map((r) => r.key), ['2026-09-16', '2026-09-19', '2026-09-12'],
    '所以順序是「9/16 買」→「9/19 買」→ 最後才是已經過去的「9/12 買」');
  eq(rangeIsPast(ranges[1], '2026-09-18'), false, '9/18（五）那天，9/16 那張還是「現在這一張」（它涵蓋到 9/18）');
  eq(rangeIsPast(ranges[1], '2026-09-19'), true, '到了 9/19 它才算過去（9/16–9/18 都吃完了）');
  eq(orderRangesForToday(ranges, '2026-09-14').map((r) => r.key), ['2026-09-12', '2026-09-16', '2026-09-19'],
    '（對照）週一站在這裡時一張都還沒過去，順序完全不變');
  eq(orderRangesForToday(ranges, '2026-09-21').map((r) => r.key), ['2026-09-12', '2026-09-16', '2026-09-19'],
    '（對照）整週都過去了也不重排 —— 全部同一類，就維持原本的時間順序');
  everyOf(orderRangesForToday(ranges, '2026-09-17'), (r) => ranges.includes(r), '一張都沒有被弄丟（只換順序，不刪東西）');
  eq(orderRangesForToday(ranges, '2026-09-17').length, ranges.length, `而且張數一樣（${ranges.length} 張）`);
  eq(rangeIsPast({ key: '2026-09-12', dates: [] }, '2026-09-17'), true, '沒有 dates 的退路：拿買菜日本身比');
  eq(rangeIsPast(ranges[0], null), false, '不知道今天是哪天就不判任何一張是過去的');
}

section('清單只算今天（含）以後的餐（fromDate）；整個過去的那張不動');
// 2026-09-18 使用者：「購物清單只列今天以後還要買／煮的」。週三買、給週三到週五的清單，週四打開時
// 週三已經煮完的食材就不再列。整個過去的清單（每一天都過了）不動 —— 它留著是為了補買。
{
  // 7 天每天晚餐一道清炒高麗菜；週三、週六買 → 9/12（給 9/14、15）、9/16（給 9/16–18）、9/19（給 9/19、20）
  const cabbageEvery = plan(dates.map((_, d) => slot(d, 'dinner', ['r-stir-fried-cabbage'])));
  const full = buildShoppingList({ plan: cabbageEvery, recipesById: byId, members: [], idx, units, shoppingDays: [3, 6] });
  const thu = buildShoppingList({ plan: cabbageEvery, recipesById: byId, members: [], idx, units, shoppingDays: [3, 6], fromDate: '2026-09-17' });
  const cab = (list, key) => list.ranges.find((r) => r.key === key).items.find((it) => it.foodId === CABBAGE)?.grams ?? 0;
  eq(full.ranges.find((r) => r.key === '2026-09-16').dates, ['2026-09-16', '2026-09-17', '2026-09-18'], '（對照）沒給 fromDate：9/16 那張給三天');
  eq(thu.ranges.find((r) => r.key === '2026-09-16').dates, ['2026-09-17', '2026-09-18'], '9/17 站在這裡：9/16 那張只剩 9/17、9/18');
  eq(thu.ranges.find((r) => r.key === '2026-09-16').allDates, ['2026-09-16', '2026-09-17', '2026-09-18'], '原本涵蓋哪幾天仍記在 allDates');
  eq(cab(full, '2026-09-16'), 450 * 3, '（對照）三天 → 450 × 3 g');
  eq(cab(thu, '2026-09-16'), 450 * 2, '剩兩天 → 450 × 2 g（週三那一餐煮完了就不再列）');
  eq(cab(thu, '2026-09-19'), cab(full, '2026-09-19'), '還沒到的那張（9/19）一樣多');
  eq(cab(thu, '2026-09-12'), cab(full, '2026-09-12'), '整個過去的那張（9/12，給 9/14、15）一克都沒少 —— 留著補買');
  eq(thu.ranges.find((r) => r.key === '2026-09-12').dates, ['2026-09-14', '2026-09-15'], '過去那張的 dates 也不動');
  eq(thu.ranges.length, full.ranges.length, '張數不變（只是內容變少，不會把清單弄丟）');
  const mon = buildShoppingList({ plan: cabbageEvery, recipesById: byId, members: [], idx, units, shoppingDays: [3, 6], fromDate: '2026-09-14' });
  eq(mon.ranges.map((r) => cab(mon, r.key)), full.ranges.map((r) => cab(full, r.key)), '（對照）週一站在這裡：什麼都還沒過，三張跟沒給 fromDate 一模一樣');
}

section('縮放倍數');
const fam = [{ ...newMember(), name: 'a', diet: 'omni' }, { ...newMember(), name: 'b', diet: 'omni' }, { ...newMember(), name: 'c', diet: 'lactoOvo' }];
// 這一段驗的是「分軌比例」，所以把下限關掉單獨看比例（下限本身在最後一節驗）。
eq(scaleFor(cabbagePork, fam, { atLeastOne: false }), { base: 3 / 4, veg: 1 / 1, meat: 2 / 3 }, '2 葷 1 蛋奶素吃高麗菜炒肉片：共用 3/4、素鍋 1/1、葷鍋 2/3');
eq(scaleFor(cabbagePork, fam).base, 1, '（同一家人，開著下限）3/4 份會補到一份 —— 五個人卻買不到一份是使用者回報的問題');
eq(scaleFor(plainCabbage, fam, { atLeastOne: false }), { base: 3 / 4, veg: 0, meat: 0 }, '不分流的菜：三個人都吃 → 3/4');
eq(scaleFor(cabbagePork, []), { base: 1, veg: 1, meat: 1 }, '沒有家人 → 照食譜原份量');
eq(scaleFor(cabbagePork, [{ ...newMember(), name: 'a' }, { ...newMember(), name: 'b' }], { atLeastOne: false }), { base: 2 / 4, veg: 0, meat: 2 / 3 }, '全家吃葷 → 素鍋 0（不買乾香菇）');
eq(scaleFor(cabbagePork, [{ ...newMember(), name: 'a', diet: 'vegan' }], { atLeastOne: false }), { base: 1 / 4, veg: 1, meat: 0 }, '只有一位全素 → 葷鍋 0（不買豬肉）');
eq(scaleFor(byId.get('r-steamed-fish'), [{ ...newMember(), name: 'a', diet: 'vegan' }]), { base: 0, veg: 0, meat: 0 }, '沒人吃得了的菜 → 全部 0');

section('加總與換算：手算對照');
const p2 = plan([slot(0, 'lunch', ['r-cabbage-pork-stirfry']), slot(0, 'dinner', ['r-stir-fried-cabbage']), slot(1, 'dinner', ['r-steamed-egg'])]);
const list = buildShoppingList({ plan: p2, recipesById: byId, members: fam, idx, units, shoppingDays: [3, 6] });
eq(list.ranges.length, 1, '週一、週二都歸上週六那個區間');
const items = list.ranges[0].items;
const cab = items.find((it) => it.foodId === CABBAGE);
// 三個人配 4 人份的食譜：比例是 3/4，但下限把它補到一份（使用者回報「五個人卻買不到一份」）。
// 高麗菜炒肉片 500 × 1 ＝ 500；清炒高麗菜 450 × 1 ＝ 450；合計 950
eq(cab.grams, 950, '高麗菜 500 ＋ 450 ＝ 950 g（跨兩餐加總，兩道都補到一份）');
eq(cab.buy, { qty: 1, unit: '顆', grams: 1000 }, '換算成 1 顆（一顆約 1000 g，無條件進位到半顆，不少買）');
eq(quantityText(cab), '約 1 顆（950 g）', '顯示文字');
eq(cab.uses.map((u) => u.recipe), ['高麗菜炒肉片', '清炒高麗菜'], '記得是哪兩道菜用到');
const pork = items.find((it) => it.name === '豬大里肌');
eq(pork.grams, 200, `豬肉片：葷鍋兩個人吃是 2/3 份，補到一份 → 200 g（${pork.grams}）`);
const mush = items.find((it) => it.foodId === 'G08101');
eq(mush.grams, 15, '乾香菇 15 × 1/1 ＝ 15 g（素鍋一個人吃、食譜素版就是 1 人份）');
const egg = items.find((it) => it.foodId === 'K01001');
eq(egg.grams, 220, '蒸蛋的雞蛋：3/4 份補到一份 → 220 g');
eq(egg.buy, { qty: 4, unit: '顆', grams: 220 }, '220 g 雞蛋（一顆 55 g）→ 4 顆');
eq(cab.section, '蔬菜', '高麗菜在蔬菜區'); eq(pork.section, '肉', '豬肉在肉區'); eq(egg.section, '豆製品蛋奶', '雞蛋在豆製品蛋奶區');
noneOf(items, (it) => ['P0300101', 'M1100101', 'P0700101'].includes(it.foodId), '鹽、油、醬油（常備品）不在主清單');
const pantryIds = list.ranges[0].pantry.map((p) => p.foodId);
ok(pantryIds.includes('P0300101') && pantryIds.includes('M1100101') && pantryIds.includes('P0700101'), '鹽、油、醬油在常備品那一段');
everyOf(items, (it) => it.grams > 0 && Number.isInteger(it.grams), '每一項克數是正整數');
everyOf(items, (it) => !it.buy || it.buy.grams >= it.grams, '有換算單位的都不少買');

section('沒有家人 → 原份量；外食不算');
const list0 = buildShoppingList({ plan: p2, recipesById: byId, members: [], idx, units, shoppingDays: [3, 6] });
eq(list0.ranges[0].items.find((it) => it.foodId === CABBAGE).grams, 950, '沒有家人：500 ＋ 450 ＝ 950 g');
eq(list0.ranges[0].items.find((it) => it.name === '豬大里肌').grams, 200, '豬肉照原份量 200 g');
const p3 = plan([slot(0, 'lunch', ['r-cabbage-pork-stirfry'], 'eatOut'), slot(0, 'dinner', ['r-stir-fried-cabbage'])]);
const list3 = buildShoppingList({ plan: p3, recipesById: byId, members: fam, idx, units, shoppingDays: [3, 6] });
eq(list3.ranges[0].items.find((it) => it.foodId === CABBAGE).grams, 450, '午餐外食：只剩晚餐那道，補到一份 → 450 g');
ok(!list3.ranges[0].items.some((it) => it.name === '豬大里肌'), '外食那餐的豬肉不買');

section('全家吃葷 → 不買素鍋的料；全素 → 不買葷鍋的料');
const omniOnly = [{ ...newMember(), name: 'a' }, { ...newMember(), name: 'b' }];
const lo = buildShoppingList({ plan: plan([slot(0, 'dinner', ['r-cabbage-pork-stirfry'])]), recipesById: byId, members: omniOnly, idx, units, shoppingDays: [] });
ok(!lo.ranges[0].items.some((it) => it.foodId === 'G08101'), '全家吃葷：乾香菇（素鍋）不買');
eq(lo.ranges[0].items.find((it) => it.name === '豬大里肌').grams, 200, '豬肉：葷鍋 2/3 份補到一份 → 200 g');
const vg = buildShoppingList({ plan: plan([slot(0, 'dinner', ['r-cabbage-pork-stirfry'])]), recipesById: byId, members: [{ ...newMember(), name: 'v', diet: 'vegan' }], idx, units, shoppingDays: [] });
ok(!vg.ranges[0].items.some((it) => it.name === '豬大里肌'), '只有全素成員：豬肉不買');
eq(vg.ranges[0].items.find((it) => it.foodId === 'G08101').grams, 15, '乾香菇買 15 g');

section('賣場分區');
const catOf = (name) => sectionOf(idx.byName.get(name) ?? idx.byId.get(aliases.aliases[name]));
eq(catOf('傳統豆腐'), '豆製品蛋奶', '傳統豆腐（加工類）→ 豆製品蛋奶');
eq(catOf('白飯'), '乾貨雜糧', '白飯 → 乾貨雜糧');
eq(catOf('鴻喜菇'), '蔬菜', '菇類 → 蔬菜區');
eq(catOf('紫菜'), '蔬菜', '藻類 → 蔬菜區');
eq(catOf('冬粉'), '乾貨雜糧', '冬粉（加工類、非豆製品）→ 乾貨雜糧');
everyOf(SECTIONS, (s) => typeof s === 'string' && s.length > 0, '七個分區');

section('真的一週：每一項都算得出來、都有分區');
const fam2 = [{ ...newMember(), name: '爸' }, { ...newMember(), name: '阿嬤', diet: 'lactoOvo' }];
const { plan: wp } = generateWeek({ recipes, members: fam2, idx, units, favorites: [], history: [], mondayIso: MONDAY, seed: 's', shoppingDays: [3, 6] });
const wl = buildShoppingList({ plan: wp, recipesById: byId, members: fam2, idx, units, shoppingDays: [3, 6] });
eq(wl.ranges.length, 3, '三個區間');
const allItems = wl.ranges.flatMap((r) => r.items);
ok(allItems.length >= 30, `（母體）${allItems.length} 個要買的項目`);
everyOf(allItems, (it) => SECTIONS.includes(it.section) && it.grams > 0 && it.labels.length > 0 && it.uses.length > 0, '每一項都有分區、正的克數、顯示名稱、用在哪');
everyOf(allItems.filter((it) => it.buy), (it) => it.buy.grams >= it.grams && Number.isInteger(it.buy.qty * 2), '有單位的：不少買、半個單位為單位');
const text = listAsText(wl.ranges[1], { checked: { [allItems[0].foodId]: true } });
ok(text.startsWith('【9/16（三）買】') && text.includes('— 蔬菜 —') && text.includes('常備品') && text.includes('估計值'), `純文字版有標題、分區、常備品、估計值提醒：\n${text.split('\n').slice(0, 4).join(' | ')}`);
detects((t) => /約 [\d.]+ (顆|把|條|盒|包|片|朵|根|支|杯|斤|塊|段|節|束|小包|隻|g)（?/.test(t), {
  shouldHit: allItems.slice(0, 6).map(quantityText),
  shouldMiss: ['高麗菜', '約 顆', '0 g'],
}, '數量文字的格式：約 N 單位');

section('逐項手改數量：建議 2 條、我要買 3 條');
// 使用者澄清「份數可調」的原意就是這個 —— 站在菜攤前對照清單，想多買就自己改。
{
  const p = plan([slot(0, 'dinner', [cabbagePork.id])]);
  const base = buildShoppingList({ plan: p, recipesById: byId, members: fam, idx, units, shoppingDays: [] });
  const key = base.ranges[0].key;
  const item0 = base.ranges[0].items.find((it) => it.foodId === CABBAGE);
  ok(item0, '（前提）清單裡有高麗菜');
  eq(item0.buy.qty, 0.5, '（手算）建議 0.5 顆（500 g，一顆 1000 g，無條件進位到 0.5）');
  eq(item0.manual, undefined, '沒改過就沒有 manual 記號');
  eq(item0.suggested.buy.qty, 0.5, '建議值一併留著（才回得去、也才講得出「原本建議多少」）');

  const edited = buildShoppingList({ plan: p, recipesById: byId, members: fam, idx, units, shoppingDays: [], manualByRange: { [key]: { [CABBAGE]: 3 } } });
  const item1 = edited.ranges[0].items.find((it) => it.foodId === CABBAGE);
  eq(item1.buy.qty, 3, '手改成 3 顆 → 就是 3 顆（不會再被進位規則改掉）');
  eq(item1.buy.grams, 3000, '（手算）3 顆 × 1000 g ＝ 3000 g');
  eq(item1.manual, true, '標成手改過');
  eq(item1.suggested.buy.qty, 0.5, '建議值還在（原本 0.5 顆）');
  eq(suggestedText(item1), '約 0.5 顆（500 g）', '「原本建議」的文字講得出來');
  eq(quantityText(item1), '約 3 顆', '畫面上顯示的是改過的值，而且不再附克數 —— 那是食譜需要的量，不是她要買的量');
  ok(quantityText(item0).includes('（500 g）'), `（對照）沒改過的仍然附需要的克數：${quantityText(item0)}`);

  // 別的項目不受影響
  const others = edited.ranges[0].items.filter((it) => it.foodId !== CABBAGE);
  ok(others.length >= 3, `（母體）另外 ${others.length} 項`);
  everyOf(others, (it) => it.manual === undefined, '只改高麗菜，其他項目沒有被標成手改');
  everyOf(others, (it) => it.grams === base.ranges[0].items.find((b) => b.foodId === it.foodId).grams, '其他項目的克數也一個都沒變');

  // 改回建議值
  const reset = buildShoppingList({ plan: p, recipesById: byId, members: fam, idx, units, shoppingDays: [], manualByRange: { [key]: {} } });
  eq(reset.ranges[0].items.find((it) => it.foodId === CABBAGE).buy.qty, 0.5, '拿掉手改的值 → 回到建議的 0.5 顆');

  // 沒有採買單位的食材：改的是克數。單一道菜的清單裡每一項都有換算，要用大一點的清單才找得到。
  eq(manualUnitOf({ grams: 300 }).unit, 'g', '沒有「幾顆幾把」換算的食材 → 用克數改');
  eq(manualUnitOf(item0).unit, '顆', '（對照）有換算的就用它自己的單位');
  // 用固定 seed 排一整週：手挑的三道菜每一項都剛好有換算，整週才找得到沒有的（櫛瓜、茭白筍這種）。
  const wide = generateWeek({ recipes, members: fam, idx, units, rules: {}, favorites: [], history: [], mondayIso: MONDAY, seed: 'nounit', shoppingDays: [] }).plan;
  const wideList = buildShoppingList({ plan: wide, recipesById: byId, members: fam, idx, units, shoppingDays: [] });
  const wideKey = wideList.ranges[0].key;
  const noUnit = wideList.ranges[0].items.find((it) => !it.buy);
  ok(noUnit, `（前提）整週的清單裡有 ${wideList.ranges[0].items.filter((x) => !x.buy).length} 項沒有換算，例如 ${noUnit?.labels[0]}`);
  const g2 = buildShoppingList({ plan: wide, recipesById: byId, members: fam, idx, units, shoppingDays: [], manualByRange: { [wideKey]: { [noUnit.foodId]: 250 } } });
  const after = g2.ranges[0].items.find((it) => it.foodId === noUnit.foodId);
  eq(after.grams, 250, '沒有換算的食材，手改的就是克數');
  eq(after.manual, true, '也標成手改過');
  eq(after.suggested.grams, noUnit.grams, `建議值仍然留著（原本 ${noUnit.grams} g）`);

  // 亂填的值不可以把清單弄壞
  everyOf([0, -3, NaN, 'abc', null], (bad) => {
    const r = buildShoppingList({ plan: p, recipesById: byId, members: fam, idx, units, shoppingDays: [], manualByRange: { [key]: { [CABBAGE]: bad } } });
    const x = r.ranges[0].items.find((it) => it.foodId === CABBAGE);
    return x.buy.qty === 0.5 && !x.manual;
  }, '0、負數、NaN、字串、null 都當作沒改（不會出現 0 顆或負的克數）');

  // 複製出去的文字要帶「已改」
  const text = listAsText(edited.ranges[0], {});
  ok(/高麗菜.*約 3 顆（已改）/.test(text), `複製的文字帶著改過的量與「已改」：${text.split('\n').find((l) => l.includes('高麗菜'))}`);
  noneOf([listAsText(base.ranges[0], {})], (t) => /已改/.test(t), '（對照）沒改過的清單不會出現「已改」');
}

section('自己加的項目：純採買備忘，不解析編號、不進任何計算');
// 使用者回報：「有時候如買水果不是在菜單裡的，只是飯後水果」。
{
  eq(sanitizeCustom(null), [], '沒給 → 空陣列');
  eq(sanitizeCustom([{ id: 'c1', name: '  蘋果 ', qty: ' 3 顆 ' }]), [{ id: 'c1', name: '蘋果', qty: '3 顆' }], '名稱與數量去掉前後空白');
  eq(sanitizeCustom([{ id: 'c1', name: '   ' }, { id: '', name: '香蕉' }, { name: '橘子' }]), [], '沒有名稱或沒有 id 的都不收');
  eq(sanitizeCustom([{ id: 'c1', name: '蘋果' }, { id: 'c1', name: '重複的' }]).length, 1, '同一個 id 只收一次');
  const long = sanitizeCustom([{ id: 'c1', name: 'x'.repeat(50), qty: 'y'.repeat(50) }])[0];
  ok(long.name.length === 30 && long.qty.length === 12, `名稱截到 30 字、數量截到 12 字（${long.name.length}／${long.qty.length}）`);
  eq(sanitizeCustom([{ id: 'c1', name: '蘋果' }])[0].qty, '', '數量可以不填（是空字串，不是 undefined）');
  eq(customKey('c1'), 'custom:c1', '勾選狀態用自己的命名空間，不會撞到食材編號');

  const p = plan([slot(0, 'dinner', [cabbagePork.id])]);
  const base = buildShoppingList({ plan: p, recipesById: byId, members: fam, idx, units, shoppingDays: [] });
  const key = base.ranges[0].key;
  eq(base.ranges[0].custom, [], '沒加任何東西 → 這張卡的自己加的是空陣列');
  const withC = buildShoppingList({ plan: p, recipesById: byId, members: fam, idx, units, shoppingDays: [],
    customByRange: { [key]: [{ id: 'c1', name: '蘋果', qty: '3 顆' }, { id: 'c2', name: '香蕉', qty: '' }] } });
  const r = withC.ranges[0];
  eq(r.custom.map((c) => c.name), ['蘋果', '香蕉'], '自己加的跟著這張卡');

  // 不進任何計算：食材清單（編號與克數）一模一樣
  const sig = (range) => range.items.map((it) => `${it.foodId}:${it.grams}`).join('|');
  ok(base.ranges[0].items.length >= 3, `（母體）食材 ${base.ranges[0].items.length} 項`);
  eq(sig(r), sig(base.ranges[0]), '加了自己加的項目，食材清單的編號與克數一項都沒變');
  eq(r.pantry.length, base.ranges[0].pantry.length, '常備品也沒變');
  noneOf(r.items, (it) => it.name === '蘋果' || it.labels.includes('蘋果') || it.name === '香蕉', '自己加的不會混進食材清單');

  // per-range：只加在第一張卡，第二張卡沒有
  const two = plan([slot(2, 'dinner', [cabbagePork.id]), slot(5, 'dinner', [cabbagePork.id])]);
  const keys = rangesOfPlan(two, [3, 6]).map((x) => x.key);
  ok(keys.length === 2, `（前提）買菜日週三＋週六 → ${keys.length} 張卡`);
  const byTwo = buildShoppingList({ plan: two, recipesById: byId, members: fam, idx, units, shoppingDays: [3, 6], customByRange: { [keys[0]]: [{ id: 'c1', name: '蘋果' }] } });
  eq(byTwo.ranges.find((x) => x.key === keys[0]).custom.length, 1, '第一張卡有');
  eq(byTwo.ranges.find((x) => x.key === keys[1]).custom, [], '第二張卡沒有（自己加的跟著加的那張卡走）');

  // 複製出去的文字：另起一段、帶名稱與數量、每一項都標「自己加的」
  const text = listAsText(r, { checked: { [customKey('c1')]: true } });
  ok(text.includes('— 自己加的（不算進菜單）—'), '複製的文字另起一段「自己加的」');
  ok(/✓ 蘋果　3 顆（自己加的）/.test(text), '勾過的那項是 ✓、帶數量、標「自己加的」');
  ok(/□ 香蕉（自己加的）/.test(text), '沒填數量的那項沒有多出空白');
  noneOf([text], (t) => /undefined|null/.test(t), '文字裡沒有 undefined／null');
  const idxCustom = text.indexOf('— 自己加的');
  const idxFood = text.indexOf('— 蔬菜');
  ok(idxFood >= 0 && idxCustom > idxFood, '自己加的排在系統算出來的食材後面');
  noneOf([listAsText(base.ranges[0], {})], (t) => /自己加的/.test(t), '（對照）沒加的清單不會出現那一段');
}

section('使用者自己加的菜裡查不到的食材：照樣列進購物清單');
{
  const ear = {
    id: 'r-user-ear', name: '滷豬耳朵', role: 'side', servings: 4, time: 0, method: 'cold', vegMode: 'meatOnly', texture: 'normal', season: [], source: 'user', vegModeConfirmed: true,
    ingredients: [{ food: null, label: '豬耳朵（切片）', grams: 300, track: 'base', unresolved: true }, { food: 'E23001', label: '青蔥', grams: 20, track: 'base' }],
    steps: [{ stage: 'base', type: 'cook', text: '切片上桌' }], tags: ['allium', 'unresolved'], vegTags: null, meatTags: ['allium', 'unresolved'], proteins: [],
  };
  const withEar = new Map([...byId, [ear.id, ear]]);
  const l = buildShoppingList({ plan: plan([slot(0, 'dinner', ['r-user-ear'])]), recipesById: withEar, members: [], idx, units, shoppingDays: [] });
  const item = l.ranges[0].items.find((it) => it.name === '豬耳朵');
  ok(item, `查不到編號的「豬耳朵」照樣在清單上：${l.ranges[0].items.map((it) => it.name).join('、')}`);
  eq([item?.grams, item?.section, item?.unresolved], [300, '調味與其他', true], '克數照食譜、放在「調味與其他」、標記是查不到的');
  ok(l.ranges[0].items.some((it) => it.foodId === 'E23001'), '（對照）同一道菜查得到的青蔥照常列');
  ok(/豬耳朵/.test(listAsText(l.ranges[0], {})), '複製出去的文字也有');
}

section('排菜葷素比例：加菜只買吃葷的人的份（走真實路徑）');
{
  // SPEC_排菜葷素比例：混合家庭每個午晚餐多一道純葷加菜。那道菜只有吃葷的人吃，
  // 所以採買量只照「吃得了的人數」算（scaleFor 的 all ／ servings），素食成員不算進去。
  const dad = { ...newMember(), name: '爸', diet: 'omni' };
  const mom = { ...newMember(), name: '媽', diet: 'lactoOvo' };
  const { plan: mixPlan } = generateWeek({ recipes, members: [dad, mom], idx, units, favorites: [], history: [],
    mondayIso: MONDAY, seed: 'extra-shop', shoppingDays: [] });
  const extraItems = mixPlan.slots.flatMap((s) => (s.items ?? []).filter((it) => it.extraMeat));
  ok(extraItems.length >= 10, `（前提）這一週有 ${extraItems.length} 道加菜`);
  const { ranges: mixRanges } = buildShoppingList({ plan: mixPlan, recipesById: byId, members: [dad, mom], idx, units, shoppingDays: [] });
  // 挑一道加菜、找它獨有的食材（只被它用到），這樣克數才歸得到它身上
  let checked = 0;
  for (const it of extraItems) {
    const r = byId.get(it.recipeId);
    const ing = r.ingredients.find((x) => !x.pantry && x.food && x.grams > 0);
    if (!ing) continue;
    const row = mixRanges[0].items.find((x) => x.foodId === ing.food);
    if (!row || row.uses.length !== 1) continue;
    // 一位吃葷的人配 4 人份的食譜＝0.25 份，但 v0.22.0 的「不少於一份」把它補到 1 份
    const scale = scaleFor(r, [dad, mom]);
    eq(row.grams, Math.round(ing.grams * scale.base), `${r.name} 的「${ing.label}」：${ing.grams} g × ${scale.base} ＝ ${row.grams} g`);
    eq(scale.veg, 0, '素鍋軌是 0 —— 媽不吃這道，一點都不買');
    checked += 1;
    if (checked >= 2) break;
  }
  ok(checked >= 1, `（母體）對照了 ${checked} 道加菜的食材`);
}

section('份數同步：每位成員各自的食量 ＋ 不少於一份');
{
  // 使用者 2026-09-16：家裡 5 人，清單份量卻不夠。診斷出兩件事 ——
  //   3 位吃葷配 4 人份的食譜會算成 0.75 份（五個人卻買不到一份）；而且家裡有人食量特別小，全家一個倍率對不上。
  const who = (diet, appetite) => ({ ...newMember(), name: 'x', diet, appetite });
  const main4 = recipes.find((r) => r.role === 'main' && r.vegMode === 'meatOnly' && r.servings === 4);
  ok(main4, `（前提）挑一道 4 人份的純葷主菜：${main4?.name}`);

  // B：不少於一份
  eq(scaleFor(main4, [who('omni'), who('omni'), who('omni')]).base, 1, '3 位吃葷配 4 人份的食譜 → 不是 0.75 份，補到一份');
  const five = [who('omni'), who('omni'), who('omni'), who('omni'), who('omni')];
  eq(scaleFor(main4, five).base, 1.25, '（對照）5 位吃葷 → 1.25 份，下限不會把它壓回一份');
  eq(scaleFor(main4, [who('veganNoAllium'), who('veganNoAllium')]).base, 0,
    '全家吃素 → 純葷的菜一點都不買（下限不可以把沒人吃的菜也拉成一份）');

  // C：每個人各自的食量
  eq(scaleFor(main4, [who('omni', 'small'), who('omni', 'small'), who('omni', 'small')]).base, 1,
    '三位小食量（0.8×3＝2.4 人份）→ 一樣補到一份');
  eq(scaleFor(main4, [who('omni', 'big'), who('omni', 'big'), who('omni', 'big'), who('omni', 'big'), who('omni', 'big')]).base, 6.25 / 4,
    '五位大食量 → 1.25×5＝6.25 人份 ÷ 4 人份的食譜');
  const oneSmallOneBig = [who('omni', 'small'), who('omni'), who('omni'), who('omni'), who('omni', 'big')];
  eq(scaleFor(main4, oneSmallOneBig).base, 5.05 / 4, '五位（一小一大）→ 0.8＋1＋1＋1＋1.25＝5.05 人份 ÷ 4');
  ok(scaleFor(main4, oneSmallOneBig).base !== scaleFor(main4, five).base,
    '（對照）跟「五位都普通」的倍率不一樣 —— 食量真的有進去，不是每人都算 1');

  // 可分流的菜：兩軌各自算、各自套下限
  const split4 = recipes.find((r) => r.vegMode === 'splittable' && r.servings === 4);
  ok(split4, `（前提）挑一道 4 人份的可分流主菜：${split4?.name}`);
  const mixedHouse = [who('lactoOvo', 'small'), who('omni'), who('omni'), who('omni'), who('omni')];
  const sp = scaleFor(split4, mixedHouse);
  eq(sp.veg, 1, '素鍋只有一位小食量 → 補到一份（素的人也要吃得飽）');
  ok(sp.meat > 1, `葷鍋四位普通 → ${sp.meat.toFixed(2)} 份`);

  // 真實路徑：整張購物清單的克數真的跟著食量走
  const planFor = (members) => generateWeek({ recipes, members, idx, units, favorites: [], history: [],
    mondayIso: MONDAY, seed: 'appetite', shoppingDays: [] }).plan;
  const gramsOfList = (members) => {
    const p = planFor(members);
    const { ranges } = buildShoppingList({ plan: p, recipesById: byId, members, idx, units, shoppingDays: [] });
    return ranges[0].items.reduce((n, it) => n + it.grams, 0);
  };
  const normalFive = gramsOfList([who('omni'), who('omni'), who('omni'), who('omni'), who('omni')]);
  const smallFive = gramsOfList([who('omni', 'small'), who('omni', 'small'), who('omni', 'small'), who('omni', 'small'), who('omni', 'small')]);
  const bigFive = gramsOfList([who('omni', 'big'), who('omni', 'big'), who('omni', 'big'), who('omni', 'big'), who('omni', 'big')]);
  ok(smallFive < normalFive && normalFive < bigFive,
    `整張清單的克數跟著食量走：小 ${smallFive} g ＜ 普通 ${normalFive} g ＜ 大 ${bigFive} g`);

  // 紅線：食量只影響採買，不影響每人一份的營養估計
  const per = estimate(main4, idx, { version: 'all' }).perServing;
  ok(per.kcal > 0, `（對照母體）這道菜每人一份估 ${Math.round(per.kcal)} kcal`);
  const fnSource = fs.readFileSync(path.join(ROOT, 'js/nutrition.js'), 'utf8');
  ok(!fnSource.includes('appetite'), '營養估算的程式碼完全不認識食量（每日估算講的是「每人一份」）');
}

section('已過的清單不顯示，沒勾的「自己加的」搬到下一張（2026-09-18 Yolin 定案）');
{
  const R = [
    { key: '2026-09-07', dates: ['2026-09-13'] },                       // 上週買、給上週日（整個過了）
    { key: '2026-09-14', dates: ['2026-09-14', '2026-09-15', '2026-09-16'] }, // 週一買（整個過了）
    { key: '2026-09-17', dates: ['2026-09-17', '2026-09-18', '2026-09-20'] }, // 週四買（今天這張）
  ];
  const rows = {
    '2026-09-07': { custom: [{ id: 'a', name: '洗碗精' }], checked: { [customKey('a')]: true } },
    '2026-09-14': { custom: [{ id: 'p', name: '衛生紙', qty: '一串' }, { id: 'q', name: '蘋果' }], checked: { [customKey('q')]: true } },
    '2026-09-17': { custom: [{ id: 'm', name: '牛奶' }], checked: {} },
  };
  const c = planCustomCarry(R, rows, '2026-09-17');
  eq(c.target, '2026-09-17', '搬到下一張還沒過的清單（今天這張）');
  eq(c.hide, ['2026-09-07', '2026-09-14'], '兩張整個過去的都不顯示');
  eq(c.moves.map((m) => [m.from, m.items.map((x) => x.name)]), [['2026-09-14', ['衛生紙']]], '只搬沒勾的衛生紙；勾掉的蘋果、洗碗精不搬');
  eq(c.moves[0].items[0].qty, '一串', '搬的時候數量跟著走');
  eq(planCustomCarry(R, rows, '2026-09-14').hide, ['2026-09-07'], '（對照）站在週一：週一那張沒過，照樣顯示');
  // 今天以後一張清單都沒有（剩下的餐都外食）：沒地方搬 → 還有沒勾的那張留著，免得備忘不見
  const none = planCustomCarry(R.slice(0, 2), rows, '2026-09-19');
  eq([none.target, none.moves.length], [null, 0], '今天以後沒有清單 → 沒地方搬');
  eq(none.hide, ['2026-09-07'], '所以還有沒勾的衛生紙的那張照樣顯示；全勾完的那張不顯示');
  eq(planCustomCarry(R, {}, '2026-09-17').moves, [], '沒有存過任何資料 → 什麼都不搬');
}

done('shoppingtest');

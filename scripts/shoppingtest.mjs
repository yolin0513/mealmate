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
import { rangesOfPlan, buildShoppingList, scaleFor, scaleWithGuests, guestScaleFor, extraText, suggestedText, manualUnitOf, sanitizeCustom, customKey, sectionOf, quantityText, listAsText, SECTIONS } from '../js/shopping.js';
import { generateWeek } from '../js/planner.js';

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

section('縮放倍數');
const fam = [{ ...newMember(), name: 'a', diet: 'omni' }, { ...newMember(), name: 'b', diet: 'omni' }, { ...newMember(), name: 'c', diet: 'lactoOvo' }];
eq(scaleFor(cabbagePork, fam), { base: 3 / 4, veg: 1 / 1, meat: 2 / 3 }, '2 葷 1 蛋奶素吃高麗菜炒肉片：共用 3/4、素鍋 1/1、葷鍋 2/3');
eq(scaleFor(plainCabbage, fam), { base: 3 / 4, veg: 0, meat: 0 }, '不分流的菜：三個人都吃 → 3/4');
eq(scaleFor(cabbagePork, []), { base: 1, veg: 1, meat: 1 }, '沒有家人 → 照食譜原份量');
eq(scaleFor(cabbagePork, [{ ...newMember(), name: 'a' }, { ...newMember(), name: 'b' }]), { base: 2 / 4, veg: 0, meat: 2 / 3 }, '全家吃葷 → 素鍋 0（不買乾香菇）');
eq(scaleFor(cabbagePork, [{ ...newMember(), name: 'a', diet: 'vegan' }]), { base: 1 / 4, veg: 1, meat: 0 }, '只有一位全素 → 葷鍋 0（不買豬肉）');
eq(scaleFor(byId.get('r-steamed-fish'), [{ ...newMember(), name: 'a', diet: 'vegan' }]), { base: 0, veg: 0, meat: 0 }, '沒人吃得了的菜 → 全部 0');

section('加總與換算：手算對照');
const p2 = plan([slot(0, 'lunch', ['r-cabbage-pork-stirfry']), slot(0, 'dinner', ['r-stir-fried-cabbage']), slot(1, 'dinner', ['r-steamed-egg'])]);
const list = buildShoppingList({ plan: p2, recipesById: byId, members: fam, idx, units, shoppingDays: [3, 6] });
eq(list.ranges.length, 1, '週一、週二都歸上週六那個區間');
const items = list.ranges[0].items;
const cab = items.find((it) => it.foodId === CABBAGE);
// 高麗菜炒肉片 500 × 3/4 ＝ 375；清炒高麗菜 450 × 3/4 ＝ 337.5；合計 712.5 → 713
eq(cab.grams, 713, '高麗菜 500×3/4 ＋ 450×3/4 ＝ 712.5 → 713 g（跨兩餐加總）');
eq(cab.buy, { qty: 1, unit: '顆', grams: 1000 }, '換算成 1 顆（一顆約 1000 g，無條件進位到半顆，不少買）');
eq(quantityText(cab), '約 1 顆（713 g）', '顯示文字');
eq(cab.uses.map((u) => u.recipe), ['高麗菜炒肉片', '清炒高麗菜'], '記得是哪兩道菜用到');
const pork = items.find((it) => it.name === '豬大里肌');
near(pork.grams, 200 * 2 / 3, 0.6, `豬肉片 200 × 2/3 ＝ 133 g（葷鍋只有兩個人吃）：${pork.grams}`);
const mush = items.find((it) => it.foodId === 'G08101');
eq(mush.grams, 15, '乾香菇 15 × 1/1 ＝ 15 g（素鍋一個人吃、食譜素版就是 1 人份）');
const egg = items.find((it) => it.foodId === 'K01001');
eq(egg.grams, 165, '蒸蛋的雞蛋 220 × 3/4 ＝ 165 g');
eq(egg.buy, { qty: 3, unit: '顆', grams: 165 }, '165 g 雞蛋（一顆 55 g）→ 3 顆');
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
eq(list3.ranges[0].items.find((it) => it.foodId === CABBAGE).grams, 338, '午餐外食：只剩晚餐的 450×3/4 ＝ 337.5 → 338 g');
ok(!list3.ranges[0].items.some((it) => it.name === '豬大里肌'), '外食那餐的豬肉不買');

section('全家吃葷 → 不買素鍋的料；全素 → 不買葷鍋的料');
const omniOnly = [{ ...newMember(), name: 'a' }, { ...newMember(), name: 'b' }];
const lo = buildShoppingList({ plan: plan([slot(0, 'dinner', ['r-cabbage-pork-stirfry'])]), recipesById: byId, members: omniOnly, idx, units, shoppingDays: [] });
ok(!lo.ranges[0].items.some((it) => it.foodId === 'G08101'), '全家吃葷：乾香菇（素鍋）不買');
near(lo.ranges[0].items.find((it) => it.name === '豬大里肌').grams, 200 * 2 / 3, 0.6, '豬肉 200 × 2/3');
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

section('這張清單多幾個人吃：客人各自加到自己那一軌');
// 高麗菜炒肉片（可分素葷）：高麗菜 500 base、乾香菇 15 veg、豬肉片 200 meat；
// servings 4、splitServings { veg: 1, meat: 3 }。家人 fam = 2 葷 ＋ 1 蛋奶素。
{
  const none = { meat: 0, veg: 0 };
  eq(guestScaleFor(cabbagePork, none), { base: 0, veg: 0, meat: 0 }, '沒加人 → 三軌都加 0');
  eq(scaleWithGuests(cabbagePork, fam, none), scaleFor(cabbagePork, fam), '沒加人時，結果跟原本的縮放**完全一樣**（預設 0 ＝ 照家裡人數）');
  eq(scaleWithGuests(cabbagePork, fam, undefined), scaleFor(cabbagePork, fam), '連 extra 都沒給也一樣');

  // 手算：2 位吃葷的客人 → 共用軌 +2/4、葷鍋 +2/3、素鍋不動
  eq(guestScaleFor(cabbagePork, { meat: 2, veg: 0 }), { base: 2 / 4, veg: 0, meat: 2 / 3 }, '2 位吃葷：共用 +2/4、葷鍋 +2/3、素鍋 +0');
  eq(scaleWithGuests(cabbagePork, fam, { meat: 2, veg: 0 }), { base: 5 / 4, veg: 1, meat: 4 / 3 }, '家人 3 人 ＋ 2 位吃葷 → 共用 5/4、素鍋維持 1、葷鍋 4/3');
  eq(scaleWithGuests(cabbagePork, fam, { meat: 2, veg: 0 }).veg, scaleFor(cabbagePork, fam).veg,
    '**分軌**：只加吃葷的客人，素鍋軌一點都沒變（全域倍率就會在這裡出錯）');

  // 手算：1 位吃素的客人 → 素鍋軌加，葷鍋不動
  eq(guestScaleFor(cabbagePork, { meat: 0, veg: 1 }), { base: 1 / 4, veg: 1 / 1, meat: 0 }, '1 位吃素：共用 +1/4、素鍋 +1/1、葷鍋 +0');
  eq(scaleWithGuests(cabbagePork, fam, { meat: 0, veg: 1 }).meat, scaleFor(cabbagePork, fam).meat, '只加吃素的客人，葷鍋軌沒變');

  // 純葷的菜：吃素的客人不算
  const fish = byId.get('r-steamed-fish');
  eq(guestScaleFor(fish, { meat: 0, veg: 3 }), { base: 0, veg: 0, meat: 0 }, '清蒸魚是純葷的：加 3 位吃素的客人，一點都不多買');
  ok(guestScaleFor(fish, { meat: 3, veg: 0 }).base > 0, `（對照）加 3 位吃葷的就會多買（+${guestScaleFor(fish, { meat: 3, veg: 0 }).base.toFixed(2)}）`);

  // 純素的菜：兩種客人都吃得到
  eq(guestScaleFor(plainCabbage, { meat: 2, veg: 1 }), { base: 3 / 4, veg: 0, meat: 0 }, '清炒高麗菜是純素的：3 位客人都算得進共用軌');

  // 亂填的值不可以把數量弄爛
  everyOf([{ meat: -5, veg: 0 }, { meat: 1.7, veg: 0 }, { meat: NaN, veg: 0 }, { meat: '2', veg: null }],
    (e) => Number.isFinite(guestScaleFor(cabbagePork, e).base) && guestScaleFor(cabbagePork, e).base >= 0,
    '負數、小數、NaN、字串都收得住（取整數、不小於 0），不會算出 NaN 或負的克數');
  eq(guestScaleFor(cabbagePork, { meat: '2', veg: null }), guestScaleFor(cabbagePork, { meat: 2, veg: 0 }), '字串 "2" 跟數字 2 同樣處理');
}

section('加人之後：先乘人數再換算顆把，常備品不乘');
{
  const p = plan([slot(0, 'dinner', [cabbagePork.id])]);
  const base = buildShoppingList({ plan: p, recipesById: byId, members: fam, idx, units, shoppingDays: [] });
  const plus = buildShoppingList({ plan: p, recipesById: byId, members: fam, idx, units, shoppingDays: [], extraByRange: { [base.ranges[0].key]: { meat: 2, veg: 0 } } });
  const gramsOf = (r, id) => r.ranges[0].items.find((it) => it.foodId === id)?.grams ?? null;
  const buyOf = (r, id) => r.ranges[0].items.find((it) => it.foodId === id)?.buy ?? null;

  // 高麗菜是共用軌：500 g × 3/4 = 375 → 加 2 位吃葷 → 500 × 5/4 = 625
  eq(gramsOf(base, CABBAGE), 375, '（手算）沒加人：高麗菜 500 × 3/4 = 375 g');
  eq(gramsOf(plus, CABBAGE), 625, '（手算）加 2 位吃葷：高麗菜 500 × 5/4 = 625 g');

  // 換算：一顆 1000 g，無條件進位到 0.5 顆。375 → 0.5 顆；625 → 1 顆。
  eq(buyOf(base, CABBAGE).qty, 0.5, '（手算）375 g → 0.5 顆');
  eq(buyOf(plus, CABBAGE).qty, 1, '（手算）625 g → 1 顆');
  // **順序**：先換算再乘的話是 0.5 × 5/3 = 0.83…（進位成 1），克數也會停在 375。
  // 拿克數當證據：625 ≠ 375，代表倍數確實作用在克數上、不是作用在顆數上。
  ok(gramsOf(plus, CABBAGE) === 625 && buyOf(plus, CABBAGE).grams === 1000,
    '先乘人數再換算：克數是 625（不是 375），顆數才由 625 去進位');

  // 素鍋軌：乾香菇 15 g × 1（一位蛋奶素）—— 加吃葷的客人不該動它
  const dried = base.ranges[0].items.find((it) => it.labels.some((l) => l.includes('香菇')));
  ok(dried, `（前提）清單裡有素鍋軌的乾香菇：${dried?.labels[0]}`);
  eq(gramsOf(plus, dried.foodId), gramsOf(base, dried.foodId), '加 2 位吃葷的客人，素鍋軌的乾香菇一克都沒多買');

  // 葷鍋軌：豬肉片 200 × 2/3 → 200 × 4/3
  const pork = base.ranges[0].items.find((it) => it.foodId === 'I0304101');
  ok(pork, `（前提）清單裡有葷鍋軌的豬里肌肉片：${pork?.labels[0]}`);
  eq(gramsOf(base, pork.foodId), Math.round(200 * 2 / 3), '（手算）沒加人：豬肉 200 × 2/3');
  eq(gramsOf(plus, pork.foodId), Math.round(200 * 4 / 3), '（手算）加 2 位吃葷：豬肉 200 × 4/3');

  // 常備品：油鹽醬油本來就只列名稱、沒有數量，所以沒有東西可乘
  ok(plus.ranges[0].pantry.length >= 2, `（母體）常備品 ${plus.ranges[0].pantry.length} 項`);
  everyOf(plus.ranges[0].pantry, (x) => x.grams === undefined && x.buy === undefined, '常備品沒有數量欄位（所以「多幾個人」對它們沒有作用）');
  eq(plus.ranges[0].pantry.map((x) => x.foodId).sort(), base.ranges[0].pantry.map((x) => x.foodId).sort(), '加人前後常備品是同一批');

  // range 上帶著它自己的人數，畫面與複製文字才講得出來
  eq(plus.ranges[0].extra, { meat: 2, veg: 0 }, 'range 帶著這張卡的人數');
  eq(base.ranges[0].extra, { meat: 0, veg: 0 }, '沒調過就是 0');
}

section('每張採買卡各自調，不會互相影響');
{
  const p = plan([slot(2, 'dinner', [cabbagePork.id]), slot(5, 'dinner', [cabbagePork.id])]);
  const r0 = buildShoppingList({ plan: p, recipesById: byId, members: fam, idx, units, shoppingDays: [3, 6] });
  ok(r0.ranges.length >= 2, `（前提）兩個買菜日 → ${r0.ranges.length} 張卡`);
  const [a, b] = r0.ranges;
  const only = buildShoppingList({ plan: p, recipesById: byId, members: fam, idx, units, shoppingDays: [3, 6], extraByRange: { [b.key]: { meat: 4, veg: 0 } } });
  const g = (rs, key, id) => rs.ranges.find((x) => x.key === key)?.items.find((it) => it.foodId === id)?.grams ?? null;
  eq(g(only, a.key, CABBAGE), g(r0, a.key, CABBAGE), '只調第二張卡，第一張卡的高麗菜一克都沒變');
  ok(g(only, b.key, CABBAGE) > g(r0, b.key, CABBAGE), `第二張卡才變多（${g(r0, b.key, CABBAGE)} → ${g(only, b.key, CABBAGE)} g）`);
  eq(only.ranges.find((x) => x.key === a.key).extra, { meat: 0, veg: 0 }, '第一張卡的人數仍然是 0');
}

section('複製出去的文字要帶到「已加 N 人」');
{
  const p = plan([slot(0, 'dinner', [cabbagePork.id])]);
  const key = buildShoppingList({ plan: p, recipesById: byId, members: fam, idx, units, shoppingDays: [] }).ranges[0].key;
  const plus = buildShoppingList({ plan: p, recipesById: byId, members: fam, idx, units, shoppingDays: [], extraByRange: { [key]: { meat: 2, veg: 1 } } });
  const text = listAsText(plus.ranges[0], {});
  ok(text.includes('多加2 位吃葷、1 位吃素') || text.includes('多加 2 位吃葷、1 位吃素') || /多加.*2 位吃葷.*1 位吃素/.test(text),
    `複製的文字講明加了幾個人：「${text.split('\n')[1]}」`);
  ok(text.includes('625') || /高麗菜/.test(text), '而且列的是調整後的數量');
  const plain = listAsText(buildShoppingList({ plan: p, recipesById: byId, members: fam, idx, units, shoppingDays: [] }).ranges[0], {});
  noneOf([plain], (t) => /多加/.test(t), '（對照）沒加人的清單不會出現那一行');
  eq(extraText({ meat: 0, veg: 0 }), '', '沒加人 → 空字串');
  eq(extraText({ meat: 2, veg: 0 }), '多加 2 位吃葷', '只加葷的');
  eq(extraText({ meat: 0, veg: 3 }), '多加 3 位吃素', '只加素的');
}

section('逐項手改數量：建議 2 條、我要買 3 條');
// 使用者澄清「份數可調」的原意就是這個 —— 站在菜攤前對照清單，想多買就自己改。
{
  const p = plan([slot(0, 'dinner', [cabbagePork.id])]);
  const base = buildShoppingList({ plan: p, recipesById: byId, members: fam, idx, units, shoppingDays: [] });
  const key = base.ranges[0].key;
  const item0 = base.ranges[0].items.find((it) => it.foodId === CABBAGE);
  ok(item0, '（前提）清單裡有高麗菜');
  eq(item0.buy.qty, 0.5, '（手算）建議 0.5 顆（375 g，一顆 1000 g，無條件進位到 0.5）');
  eq(item0.manual, undefined, '沒改過就沒有 manual 記號');
  eq(item0.suggested.buy.qty, 0.5, '建議值一併留著（才回得去、也才講得出「原本建議多少」）');

  const edited = buildShoppingList({ plan: p, recipesById: byId, members: fam, idx, units, shoppingDays: [], manualByRange: { [key]: { [CABBAGE]: 3 } } });
  const item1 = edited.ranges[0].items.find((it) => it.foodId === CABBAGE);
  eq(item1.buy.qty, 3, '手改成 3 顆 → 就是 3 顆（不會再被進位規則改掉）');
  eq(item1.buy.grams, 3000, '（手算）3 顆 × 1000 g ＝ 3000 g');
  eq(item1.manual, true, '標成手改過');
  eq(item1.suggested.buy.qty, 0.5, '建議值還在（原本 0.5 顆）');
  eq(suggestedText(item1), '約 0.5 顆（375 g）', '「原本建議」的文字講得出來');
  eq(quantityText(item1), '約 3 顆', '畫面上顯示的是改過的值，而且不再附「（375 g）」—— 那是食譜需要的量，不是她要買的量');
  ok(quantityText(item0).includes('（375 g）'), `（對照）沒改過的仍然附需要的克數：${quantityText(item0)}`);

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

section('手改與「多幾個人吃」並存時，手改優先');
{
  const p = plan([slot(0, 'dinner', [cabbagePork.id])]);
  const key = buildShoppingList({ plan: p, recipesById: byId, members: fam, idx, units, shoppingDays: [] }).ranges[0].key;
  const both = buildShoppingList({ plan: p, recipesById: byId, members: fam, idx, units, shoppingDays: [],
    extraByRange: { [key]: { meat: 2, veg: 0 } }, manualByRange: { [key]: { [CABBAGE]: 3 } } });
  const it = both.ranges[0].items.find((x) => x.foodId === CABBAGE);
  eq(it.buy.qty, 3, '手改的 3 顆蓋過「多 2 人」算出來的建議值');
  eq(it.suggested.buy.qty, 1, '（手算）而「原本建議」是含 2 位客人的 625 g → 1 顆，不是沒加人的 0.5 顆');
  const otherItem = both.ranges[0].items.find((x) => x.foodId !== CABBAGE && !x.manual);
  ok(otherItem, '（前提）還有沒被手改的項目');
  eq(otherItem.manual, undefined, '沒手改的項目仍然照「多幾個人」算');
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

done('shoppingtest');

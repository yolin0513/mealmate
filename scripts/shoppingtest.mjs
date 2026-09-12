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
import { rangesOfPlan, buildShoppingList, scaleFor, sectionOf, quantityText, listAsText, SECTIONS } from '../js/shopping.js';
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

done('shoppingtest');

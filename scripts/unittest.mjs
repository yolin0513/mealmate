// 採買單位、匙量、保存天數（npm run unittest）—— 這裡的 unit 是「一顆、一把」那種單位。
//
// 守的事：units.json 的鍵都是別名表裡的口語詞；每個分類都有保存天數預設；
// 換算不會少買（無條件進位到半個單位），也不會多買超過一個單位。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ok, eq, section, done, everyOf, detects } from './tap.mjs';
import { toBuyQty, spoonToGrams, shelfDaysFor } from '../js/units.js';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const units = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/units.json'), 'utf8'));
const aliases = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/aliases.json'), 'utf8'));
const foods = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/foods.json'), 'utf8'));
const aliasTerms = new Set(Object.keys(aliases.aliases));
const skipNote = (obj) => Object.entries(obj).filter(([k]) => k !== 'note');

section('鍵都是別名表裡的口語詞');
const buy = skipNote(units.buyUnits);
const spoons = skipNote(units.spoonGrams);
const overrides = skipNote(units.shelfDays.overrides);
ok(buy.length >= 80, `採買單位 ${buy.length} 個`);
everyOf(buy, ([term]) => aliasTerms.has(term), 'buyUnits 的鍵都在別名表裡');
everyOf(spoons, ([term]) => aliasTerms.has(term), 'spoonGrams 的鍵都在別名表裡');
everyOf(overrides, ([term]) => aliasTerms.has(term), 'shelfDays.overrides 的鍵都在別名表裡');
everyOf(buy, ([, d]) => typeof d.unit === 'string' && d.unit && typeof d.grams === 'number' && d.grams > 0, '每個採買單位都有 unit 與正的 grams');
everyOf(spoons, ([, d]) => Object.values(d).every((g) => typeof g === 'number' && g > 0), '每個匙量都是正數');
everyOf(overrides, ([, d]) => Number.isInteger(d) && d >= 1, '保存天數都是 ≥1 的整數');

section('每個食藥署分類都有保存天數預設');
const cats = [...new Set(foods.foods.map((f) => f.cat))];
ok(cats.length >= 15, `（母體）foods.json 有 ${cats.length} 個分類`);
everyOf(cats, (c) => Number.isInteger(units.shelfDays.byCategory[c]) && units.shelfDays.byCategory[c] >= 1, '每個分類在 byCategory 都有值');
ok(units.shelfDays.byCategory['蔬菜類'] <= 3, `蔬菜類預設 ${units.shelfDays.byCategory['蔬菜類']} 天（葉菜要在買菜日後 3 天內煮掉）`);
ok(units.shelfDays.byCategory['魚貝類'] <= 2, `魚貝類預設 ${units.shelfDays.byCategory['魚貝類']} 天`);

section('換算：不少買、不多買一整個單位');
const samples = [0.3, 0.5, 0.9, 1, 1.2, 1.5, 1.7, 2.6, 3];
const cases = buy.flatMap(([term, d]) => samples.map((k) => ({ term, d, grams: d.grams * k })));
ok(cases.length >= 700, `（母體）${cases.length} 組換算案例`);
everyOf(cases, ({ d, grams }) => toBuyQty(grams, d).grams >= grams - 1e-9, '換算後的總克數 ≥ 需要的克數（不會少買）');
everyOf(cases, ({ d, grams }) => toBuyQty(grams, d).grams - grams < d.grams / 2 + 1e-9, '多買的部分 < 半個單位');
everyOf(cases, ({ d, grams }) => Number.isInteger(toBuyQty(grams, d).qty * 2), '數量是 0.5 的倍數');
eq(toBuyQty(437, { unit: '顆', grams: 1000 }), { qty: 0.5, unit: '顆', grams: 500 }, '437 克高麗菜 → 0.5 顆');
eq(toBuyQty(1001, { unit: '顆', grams: 1000 }), { qty: 1.5, unit: '顆', grams: 1500 }, '1001 克 → 1.5 顆（多一克也要進位）');
eq(toBuyQty(0, { unit: '顆', grams: 1000 }), null, '0 克 → null');
eq(toBuyQty(100, null), null, '沒有單位定義 → null（不猜）');
// 對照組：一個「用四捨五入」的壞換算會少買 —— 證明上面那條「不會少買」真的分得出好壞
const badRound = (grams, d) => ({ qty: Math.round(grams / d.grams * 2) / 2, grams: Math.round(grams / d.grams * 2) / 2 * d.grams });
detects((fn) => cases.every(({ d, grams }) => fn(grams, d).grams >= grams - 1e-9), {
  shouldHit: [toBuyQty],
  shouldMiss: [badRound],
}, '「不會少買」這條分得出無條件進位（對）與四捨五入（錯）');

section('匙量');
eq(spoonToGrams('鹽', '小匙', units), 6, '1 小匙鹽 ≈ 6 克');
eq(spoonToGrams('醬油', '大匙', units), 18, '1 大匙醬油 ≈ 18 克');
eq(spoonToGrams('鹽', '一桶', units), null, '認不得的匙 → null');
eq(spoonToGrams('不存在', '小匙', units), null, '沒列的調味料 → null');

section('保存天數：override 優先，再用分類預設');
eq(shelfDaysFor({ alias: '高麗菜', cat: '蔬菜類' }, units), 10, '高麗菜有 override → 10 天，不是蔬菜類的 3 天');
eq(shelfDaysFor({ alias: '青江菜', cat: '蔬菜類' }, units), 3, '青江菜沒 override → 蔬菜類預設 3 天');
eq(shelfDaysFor({ alias: null, cat: '魚貝類' }, units), 2, '沒有口語詞也拿得到分類預設');
eq(shelfDaysFor({ alias: '不存在', cat: '不存在的分類' }, units), null, '兩個都沒有 → null');
ok(shelfDaysFor({ alias: '文蛤', cat: '魚貝類' }, units) === 1, '文蛤 override 1 天');

done('unittest');

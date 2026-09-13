// 家人模型（npm run membertest）：留意欄位推導、飲食型態判斷、驗證。
//
// 紅線在這裡有形狀：腎臟病沒勾子項 → 什麼欄位都不帶（不自動限鉀）；
// 新家人的每日目標全部 null（App 不替任何人設目標）。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ok, eq, section, done, everyOf, noneOf, detects } from './tap.mjs';
import {
  watchFields, familyWatchFields, validateMember, newMember, versionFor, fitsDiet, allergenHits, splitByDiet,
  KIDNEY_FIELDS, TARGET_FIELDS, CONDITION_FIELDS, DIETS, displayFields,
} from '../js/members.js';
import { NUTRIENT_ORDER } from '../js/foods.js';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const recipes = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/recipes.json'), 'utf8')).recipes;

section('留意欄位：腎臟病只帶使用者勾的');
const kidneyNone = { ...newMember(), conditions: ['kidney'], kidneyWatch: [] };
eq(watchFields(kidneyNone), [], '腎臟病但沒勾任何子項 → 不帶任何欄位（不自動限鉀）');
noneOf(KIDNEY_FIELDS, (k) => watchFields(kidneyNone).includes(k), '（同一件事換個方向）鈉／鉀／磷／蛋白質一個都沒有');
eq(watchFields({ ...newMember(), conditions: ['kidney'], kidneyWatch: ['sodium', 'phosphorus'] }), ['sodium', 'phosphorus'], '勾鈉、磷 → 只有鈉、磷');
eq(watchFields({ ...newMember(), conditions: ['kidney'], kidneyWatch: ['potassium'] }), ['potassium'], '只勾鉀 → 只有鉀');
eq(watchFields({ ...newMember(), conditions: ['diabetes'] }), ['carb', 'sugar', 'fiber'], '糖尿病 → 醣、糖、膳食纖維');
eq(watchFields({ ...newMember(), conditions: ['hypertension'] }), ['sodium'], '高血壓 → 鈉');
eq(watchFields({ ...newMember(), conditions: ['lipid'] }), ['satFat', 'cholesterol'], '高血脂 → 飽和脂肪、膽固醇');
eq(watchFields({ ...newMember(), conditions: ['diabetes', 'hypertension', 'kidney'], kidneyWatch: ['sodium', 'protein'] }), ['carb', 'sugar', 'fiber', 'sodium', 'protein'], '多個項目：聯集、不重複（鈉只出現一次）');
eq(watchFields(newMember()), [], '沒有任何留意項目 → 空');
eq(CONDITION_FIELDS.kidney, [], '（結構）腎臟病本身不帶預設欄位');
eq(familyWatchFields([{ ...newMember(), conditions: ['diabetes'] }, { ...newMember(), conditions: ['hypertension'] }]), ['carb', 'sugar', 'fiber', 'sodium'], '全家聯集');
eq(familyWatchFields([]), [], '沒有家人 → 空');

section('新家人的預設值');
const m = newMember();
eq(m.conditions, [], '沒有留意項目');
eq(m.kidneyWatch, [], '腎臟病子項沒勾');
everyOf(TARGET_FIELDS, (k) => m.targets[k] === null, '每日目標每一欄都是 null（App 不替任何人設目標）');
ok(Object.keys(m.targets).length === TARGET_FIELDS.length, `目標欄位 ${TARGET_FIELDS.length} 個`);
ok(/^m-/.test(m.id), 'id 有前綴');

section('驗證');
eq(validateMember({ ...newMember(), name: '阿嬤' }), [], '正常的家人通過');
detects((x) => validateMember(x).length > 0, {
  shouldHit: [
    { ...newMember(), name: '' },
    { ...newMember(), name: '   ' },
    { ...newMember(), name: '阿嬤', diet: 'pescatarian' },
    { ...newMember(), name: '阿嬤', conditions: ['gout'] },
    { ...newMember(), name: '阿嬤', conditions: ['kidney'], kidneyWatch: ['iron'] },
    { ...newMember(), name: '阿嬤', targets: { ...newMember().targets, carb: -5 } },
    { ...newMember(), name: '阿嬤', targets: { ...newMember().targets, carb: 'abc' } },
    { ...newMember(), name: '阿嬤', allergens: ['soy'] },
  ],
  shouldMiss: [
    { ...newMember(), name: '阿嬤' },
    { ...newMember(), name: '爸', diet: 'veganNoAllium', conditions: ['kidney'], kidneyWatch: ['potassium'], allergens: ['peanut'] },
    { ...newMember(), name: '媽', targets: { ...newMember().targets, carb: 180 } },
  ],
}, '驗證器抓得到空暱稱、不認得的型態／項目／欄位、負的或非數字的目標；放行正常的');

section('飲食型態 vs 食譜（用真的內建食譜）');
const byId = new Map(recipes.map((r) => [r.id, r]));
const cabbagePork = byId.get('r-cabbage-pork-stirfry');   // splittable，base 有薑無蔥蒜
const tomatoEgg = byId.get('r-tomato-egg');                // nativeVeg，有蛋、青蔥（可省略）
const steamedFish = byId.get('r-steamed-fish');            // meatOnly
const bokChoy = byId.get('r-ginger-bok-choy');             // nativeVeg，零標籤
const threeCup = byId.get('r-three-cup-split');            // splittable，base 有蒜（不可省略）
ok(cabbagePork && tomatoEgg && steamedFish && bokChoy && threeCup, '（母體）五道用來驗的食譜都在');
eq(versionFor(cabbagePork, 'omni'), 'meat', '葷食者吃可分流菜的葷版');
eq(versionFor(cabbagePork, 'lactoOvo'), 'veg', '蛋奶素吃可分流菜的素版');
eq(versionFor(cabbagePork, 'veganNoAllium'), 'veg', '高麗菜炒肉片 base 只有薑 → 全素不含五辛也能吃素版');
eq(versionFor(threeCup, 'veganNoAllium'), null, '三杯的 base 有蒜且不可省略 → 全素不含五辛吃不了');
eq(versionFor(threeCup, 'vegan'), 'veg', '全素（可吃五辛）可以吃三杯杏鮑菇');
eq(versionFor(tomatoEgg, 'lactoOvo'), 'all', '蛋奶素可以吃番茄炒蛋');
eq(versionFor(tomatoEgg, 'vegan'), null, '全素不能吃番茄炒蛋（有蛋）');
eq(versionFor(steamedFish, 'lactoOvo'), null, '蛋奶素不能吃清蒸魚');
eq(versionFor(steamedFish, 'omni'), 'all', '葷食者吃清蒸魚');
eq(versionFor(bokChoy, 'veganNoAllium'), 'all', '薑絲青江菜零標籤 → 全素不含五辛可吃');
const noAlliumOk = recipes.filter((r) => fitsDiet(r, 'veganNoAllium'));
ok(noAlliumOk.length >= 5, `（母體）${noAlliumOk.length} 道全素不含五辛可吃`);
everyOf(noAlliumOk, (r) => {
  const tags = r.vegMode === 'splittable' ? r.vegTags : r.tags;
  return !tags.includes('meat') && !tags.includes('seafood') && !tags.includes('egg') && !tags.includes('dairy') && (!tags.includes('allium') || r.alliumOptional);
}, '全素不含五辛可吃的每一道，吃到的版本都沒有肉／海鮮／蛋／奶，五辛只在可省略時出現');
const tagged = recipes.filter((r) => (r.vegMode === 'splittable' ? r.vegTags : r.tags).some((t) => ['meat', 'seafood', 'egg', 'dairy', 'allium'].includes(t)) || r.vegMode === 'meatOnly');
ok(tagged.length >= 15, `（對照母體）池裡有 ${tagged.length} 道帶這些標籤，所以上一條不是空談`);
everyOf(DIETS, (d) => recipes.some((r) => fitsDiet(r, d)), '每一種飲食型態都至少有菜可吃');
ok(recipes.filter((r) => fitsDiet(r, 'omni')).length === recipes.length, '葷食者每一道都能吃');

section('過敏原與分流份數');
const peanutPerson = { ...newMember(), name: 'A', allergens: ['seafood'] };
eq(allergenHits(steamedFish, peanutPerson), ['seafood'], '對海鮮過敏的人看清蒸魚 → 命中海鮮');
eq(allergenHits(bokChoy, peanutPerson), [], '看青江菜 → 沒有');
const clam = byId.get('r-clam-loofah-split');
eq(allergenHits(clam, { ...peanutPerson, diet: 'lactoOvo' }), [], '蛋奶素的海鮮過敏者吃蛤蜊絲瓜的素版 → 素版沒有海鮮');
eq(allergenHits(clam, peanutPerson), ['seafood'], '葷食的海鮮過敏者吃蛤蜊絲瓜的葷版 → 命中');
const fam = [{ ...newMember(), name: 'a', diet: 'omni' }, { ...newMember(), name: 'b', diet: 'omni' }, { ...newMember(), name: 'c', diet: 'lactoOvo' }, { ...newMember(), name: 'd', diet: 'vegan' }];
const sp = splitByDiet(cabbagePork, fam);
eq([sp.veg.length, sp.meat.length, sp.none.length], [2, 2, 0], '四人家庭（2 葷 1 蛋奶素 1 全素）吃高麗菜炒肉片：素版 2、葷版 2');
const sp2 = splitByDiet(tomatoEgg, fam);
eq([sp2.veg.length, sp2.meat.length, sp2.none.length], [3, 0, 1], '番茄炒蛋：3 人吃（素的菜算素版）、全素那位吃不了');

section('留意欄位的順序：照營養素的固定順序，不照誰先被加進來');
{
  const lipid = { ...newMember(), id: 'a', name: '甲', conditions: ['lipid'] };
  const diab = { ...newMember(), id: 'b', name: '乙', conditions: ['diabetes'] };
  const salt = { ...newMember(), id: 'c', name: '丙', conditions: ['hypertension'] };
  const one = familyWatchFields([lipid, diab, salt]);
  const two = familyWatchFields([salt, diab, lipid]);
  eq(one, two, `換家人的新增順序，欄位順序不變（${one.join('、')}）`);
  eq(one, NUTRIENT_ORDER.filter((k) => one.includes(k)), '而且就是 NUTRIENT_ORDER 的順序');
  ok(one.indexOf('satFat') < one.indexOf('carb') && one.indexOf('carb') < one.indexOf('sodium'),
    '飽和脂肪排在醣前面、醣排在鈉前面（跟食品標示的順序一致）');
  const d = displayFields([salt, diab, lipid]);
  eq(d.slice(0, 2), ['kcal', 'protein'], '顯示欄位仍然是熱量、蛋白質打頭');
  eq(d.slice(2), one, '後面接的就是排好序的留意欄位');
  eq(familyWatchFields([]), [], '沒有人留意任何項目 → 空陣列（不是硬塞 12 項）');
}

done('membertest');

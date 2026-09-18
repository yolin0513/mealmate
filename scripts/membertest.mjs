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
  KIDNEY_FIELDS, TARGET_FIELDS, CONDITION_FIELDS, CONDITIONS, CONDITION_LABELS, matchesCondition, DIETS, DIET_LABELS, displayFields,
  APPETITES, APPETITE_FACTORS, appetiteOf, VEG_DIET_FLAGS, VEG_EATS, VEG_EAT_LABELS, dietFlags, dietFromFlags, dietSentence,
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
eq(versionFor(cabbagePork, 'veganNoAllium'), 'veg', '高麗菜炒肉片 base 只有薑 → 全素（不吃五辛）也能吃素版');
eq(versionFor(threeCup, 'veganNoAllium'), null, '三杯的 base 有蒜且不可省略 → 全素（不吃五辛）吃不了');
eq(versionFor(threeCup, 'vegan'), 'veg', '全素（可吃五辛）可以吃三杯杏鮑菇');
eq(versionFor(tomatoEgg, 'lactoOvo'), 'all', '蛋奶素可以吃番茄炒蛋');
eq(versionFor(tomatoEgg, 'vegan'), null, '全素不能吃番茄炒蛋（有蛋）');
eq(versionFor(steamedFish, 'lactoOvo'), null, '蛋奶素不能吃清蒸魚');
eq(versionFor(steamedFish, 'omni'), 'all', '葷食者吃清蒸魚');
eq(versionFor(bokChoy, 'veganNoAllium'), 'all', '薑絲青江菜零標籤 → 全素（不吃五辛）可吃');
const noAlliumOk = recipes.filter((r) => fitsDiet(r, 'veganNoAllium'));
ok(noAlliumOk.length >= 5, `（母體）${noAlliumOk.length} 道全素（不吃五辛）可吃`);
everyOf(noAlliumOk, (r) => {
  const tags = r.vegMode === 'splittable' ? r.vegTags : r.tags;
  return !tags.includes('meat') && !tags.includes('seafood') && !tags.includes('egg') && !tags.includes('dairy') && (!tags.includes('allium') || r.alliumOptional);
}, '全素（不吃五辛）可吃的每一道，吃到的版本都沒有肉／海鮮／蛋／奶，五辛只在可省略時出現');
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

section('素食標籤的語意：五辛素吃得到蔥蒜、全素吃不到');
{
  // 2026-09-16 定案：一般講「全素」就是不含五辛。原本把可吃五辛的那個叫「全素」，名稱與行為對不起來。
  // 這一節把「名稱」與「versionFor 的行為」綁在一起 —— 以後誰把兩個標籤對調，這裡就會紅。
  eq(DIET_LABELS.vegan, '五辛素', '可吃五辛的那個叫「五辛素」');
  eq(DIET_LABELS.veganNoAllium, '全素', '連五辛都不吃的那個叫「全素」');
  noneOf(Object.values(DIET_LABELS), (t) => t.includes('不含五辛'), '畫面上不再有「全素不含五辛」這個標籤');
  const alliumVeg = recipes.find((r) => r.vegMode === 'nativeVeg' && r.tags.includes('allium') && !r.alliumOptional);
  ok(alliumVeg, `（前提）挑到一道有蔥蒜、不可省略的素菜：${alliumVeg?.name}`);
  eq(versionFor(alliumVeg, 'vegan'), 'all', `「${DIET_LABELS.vegan}」吃得到有蔥蒜的素菜（${alliumVeg?.name}）`);
  eq(versionFor(alliumVeg, 'veganNoAllium'), null, `「${DIET_LABELS.veganNoAllium}」吃不到有蔥蒜的素菜`);
  const plainVeg = recipes.find((r) => r.vegMode === 'nativeVeg' && !r.tags.includes('allium') && !r.tags.includes('egg') && !r.tags.includes('dairy'));
  ok(plainVeg, `（對照母體）也有完全不含蔥蒜蛋奶的素菜：${plainVeg?.name}`);
  eq(versionFor(plainVeg, 'veganNoAllium'), 'all', '那種菜「全素」照樣吃得到（上面那條不是因為全素什麼都不能吃）');
}

section('素食三個勾（2026-09-18 Yolin 定案方案 A）：舊的三種判斷一道都沒變');
{
  // 改版前的 versionFor 原文照抄在這裡當對照組：蛋奶素／五辛素／全素三個舊值，217 道每一道都要跟以前一樣。
  // 「既有的排菜結果不變」就靠這一條 —— 判斷一樣，排菜器拿到的可吃清單就一樣。
  function legacyVersionFor(recipe, diet) {
    const split = recipe.vegMode === 'splittable';
    if (diet === 'omni') return split ? 'meat' : 'all';
    const tags = split ? (recipe.vegTags ?? []) : (recipe.tags ?? []);
    if (recipe.vegMode === 'meatOnly') return null;
    if (tags.includes('meat') || tags.includes('seafood')) return null;
    if (diet === 'lactoOvo') return split ? 'veg' : 'all';
    if (tags.includes('unresolved')) return null;
    if (tags.includes('egg') || tags.includes('dairy')) return null;
    if (diet === 'vegan') return split ? 'veg' : 'all';
    if (diet === 'veganNoAllium') {
      if (tags.includes('allium') && !recipe.alliumOptional) return null;
      return split ? 'veg' : 'all';
    }
    return null;
  }
  const unresolvedVeg = { id: 'x', name: '自己加的菜', vegMode: 'nativeVeg', tags: ['unresolved'] };
  const pool = [...recipes, unresolvedVeg];
  for (const d of ['omni', 'lactoOvo', 'vegan', 'veganNoAllium']) {
    everyOf(pool, (r) => versionFor(r, d) === legacyVersionFor(r, d), `「${DIET_LABELS[d]}」（${d}）${pool.length} 道的判斷跟改版前逐道相同`);
  }
  eq(dietFlags('lactoOvo'), { egg: true, dairy: true, allium: true }, '舊的蛋奶素＝三個勾全開');
  eq(dietFlags('vegan'), { egg: false, dairy: false, allium: true }, '舊的五辛素＝只勾五辛');
  eq(dietFlags('veganNoAllium'), { egg: false, dairy: false, allium: false }, '舊的全素＝三個都不勾');
  eq(dietFlags('omni'), null, '葷不是素食組合');
}

section('素食三個勾：八種組合各自成立，每個勾都真的有作用');
{
  const combos = Object.keys(VEG_DIET_FLAGS);
  eq(combos.length, 8, '三個勾 → 八種組合');
  eq(DIETS, ['omni', ...combos], 'DIETS＝葷＋八種素食');
  everyOf(combos, (k) => dietFromFlags(dietFlags(k)) === k, '三個勾組回去一定回到同一個鍵（沒有兩個鍵撞在同一組勾）');
  everyOf(combos, (k) => typeof DIET_LABELS[k] === 'string' && DIET_LABELS[k].length > 0, '每一種組合都有名稱');
  eq(new Set(combos.map((k) => DIET_LABELS[k])).size, 8, '八個名稱都不一樣');
  everyOf(combos, (k) => validateMember({ ...newMember(), name: 'a', diet: k }).length === 0, '八種都通過成員驗證（新值存得進去、備份匯得回來）');
  eq(validateMember({ ...newMember(), name: 'a', diet: 'veg' }).some((e) => e.includes('飲食型態')), true, '畫面上的「素」不是可存的值（一定要組成八種之一）');
  eq(versionFor(recipes[0], 'nonsense'), null, '認不得的值 → 吃不了（寧可少排，不可排錯）');

  const tagsOf = (r) => (r.vegMode === 'splittable' ? r.vegTags : r.tags) ?? [];
  // 紅線：吃到的那個版本，不能含他不吃的東西。八種組合 × 217 道逐道驗。
  for (const k of combos) {
    const f = dietFlags(k);
    everyOf(recipes.filter((r) => fitsDiet(r, k)), (r) => {
      const t = tagsOf(r);
      return !t.includes('meat') && !t.includes('seafood') && r.vegMode !== 'meatOnly'
        && (f.egg || !t.includes('egg')) && (f.dairy || !t.includes('dairy')) && (f.allium || !t.includes('allium') || r.alliumOptional);
    }, `「${DIET_LABELS[k]}」可吃的每一道：沒有肉海鮮，也沒有他沒勾的東西`);
  }
  // 多勾一樣只會多吃到菜，不會少：每個勾的「開」都是「關」的超集合
  for (const k of combos) for (const e of VEG_EATS) {
    const f = dietFlags(k);
    if (f[e]) continue;
    const more = dietFromFlags({ ...f, [e]: true });
    everyOf(recipes.filter((r) => fitsDiet(r, k)), (r) => fitsDiet(r, more), `「${DIET_LABELS[k]}」多勾「${VEG_EAT_LABELS[e]}」→「${DIET_LABELS[more]}」，原本吃得到的都還吃得到`);
  }
  const byName = (n) => recipes.find((r) => r.name === n);
  const eggDish = byName('九層塔煎蛋');
  const dairyDish = byName('起司焗南瓜');
  ok(eggDish && dairyDish, '（前提）找得到有蛋的素菜、有奶的素菜');
  eq([versionFor(eggDish, 'ovo'), versionFor(eggDish, 'lacto')].map(Boolean), [true, false], `有蛋的菜（${eggDish?.name}）：蛋素吃得到、奶素吃不到`);
  eq([versionFor(dairyDish, 'lacto'), versionFor(dairyDish, 'ovo')].map(Boolean), [true, false], `有奶的菜（${dairyDish?.name}）：奶素吃得到、蛋素吃不到`);
  eq(Boolean(versionFor(dairyDish, 'lactoNoAllium')), !tagsOf(dairyDish).includes('allium') || !!dairyDish.alliumOptional, '奶素・不吃五辛看起司焗南瓜：只看有沒有五辛');
  const alliumVeg = recipes.find((r) => r.vegMode === 'nativeVeg' && r.tags.includes('allium') && !r.alliumOptional && !r.tags.includes('egg') && !r.tags.includes('dairy'));
  ok(alliumVeg, `（前提）有蔥蒜、不可省略、無蛋奶的素菜：${alliumVeg?.name}`);
  eq(combos.filter((k) => fitsDiet(alliumVeg, k)).sort(), combos.filter((k) => dietFlags(k).allium).sort(), `「${alliumVeg?.name}」：勾了五辛的四種吃得到，沒勾的四種吃不到`);
  const unresolvedVeg = { id: 'x', name: '自己加的菜', vegMode: 'nativeVeg', tags: ['unresolved'] };
  eq(combos.filter((k) => fitsDiet(unresolvedVeg, k)), ['lactoOvo'], '有查不到的食材（蛋奶五辛都判斷不了）：只有三樣都吃的人排得到');
  const counts = combos.map((k) => recipes.filter((r) => fitsDiet(r, k)).length);
  ok(counts.every((n) => n >= 20), `八種組合每一種都至少有 20 道可吃（${counts.join('、')}）`);

  eq(dietSentence('omni'), '什麼都吃', '葷的說明');
  eq(dietSentence('lactoOvo'), '不吃肉、海鮮；吃蛋、奶、蔥、蒜、韭、洋蔥等五辛', '蛋奶素的說明');
  eq(dietSentence('ovoNoAllium'), '不吃肉、海鮮、奶、蔥、蒜、韭、洋蔥等五辛；吃蛋', '蛋素（不吃五辛）的說明');
  eq(dietSentence('veganNoAllium'), '不吃肉、海鮮、蛋、奶、蔥、蒜、韭、洋蔥等五辛', '全素的說明（沒有「吃」那半句）');
}

section('慢性病清單：只收資料庫撐得起數字的；搜尋比對名稱與口語說法');
{
  // 使用者 2026-09-16：清單要擴充、要能用搜尋挑。紅線是「沒有數字的病先不要加」——
  // 食藥署資料庫只有 12 個欄位，沒有普林（痛風）也沒有鐵（貧血）。
  ok(CONDITIONS.length >= 10, `（母體）慢性病 ${CONDITIONS.length} 項`);
  everyOf(CONDITIONS.filter((c) => c !== 'kidney'), (c) => (CONDITION_FIELDS[c] ?? []).length > 0,
    '除了腎臟病（欄位由使用者自己勾）以外，每一項都對得到至少一個食藥署欄位');
  everyOf(CONDITIONS.flatMap((c) => CONDITION_FIELDS[c] ?? []), (f) => NUTRIENT_ORDER.includes(f),
    '沒有任何一項指到資料庫沒有的欄位');
  everyOf(CONDITIONS, (c) => typeof CONDITION_LABELS[c] === 'string' && CONDITION_LABELS[c].length > 0, '每一項都有中文名稱');
  eq(watchFields({ conditions: ['cardio'], kidneyWatch: [] }), ['satFat', 'cholesterol', 'sodium'], '心血管疾病 → 飽和脂肪、膽固醇、鈉');
  eq(watchFields({ conditions: ['osteoporosis'], kidneyWatch: [] }), ['calcium'], '骨質疏鬆 → 鈣');
  eq(watchFields({ conditions: ['constipation'], kidneyWatch: [] }), ['fiber'], '腸道不順 → 膳食纖維');
  eq(watchFields({ conditions: ['kidney', 'osteoporosis'], kidneyWatch: [] }), ['calcium'],
    '（紅線）多選了腎臟病也不會自己冒出鈉鉀磷蛋白質');
  eq(CONDITIONS.filter((c) => matchesCondition(c, '血壓')), ['hypertension'], '搜尋「血壓」→ 高血壓');
  eq(CONDITIONS.filter((c) => matchesCondition(c, '糖尿')), ['diabetes', 'prediabetes'], '搜尋「糖尿」→ 糖尿病與糖尿病前期');
  eq(CONDITIONS.filter((c) => matchesCondition(c, '骨鬆')), ['osteoporosis'], '打口語說法也找得到（骨鬆 → 骨質疏鬆）');
  eq(CONDITIONS.filter((c) => matchesCondition(c, '洗腎')), ['kidney'], '「洗腎」找得到腎臟病');
  eq(CONDITIONS.filter((c) => matchesCondition(c, '')), CONDITIONS, '沒打字 → 全部都在');
  eq(CONDITIONS.filter((c) => matchesCondition(c, '痛風')), [], '搜尋「痛風」查不到（沒有普林資料，清單裡本來就沒有）');
  eq(CONDITIONS.filter((c) => matchesCondition(c, '貧血')), [], '搜尋「貧血」也查不到（沒有鐵）');
}

section('食量：每個人各自設，舊資料當普通');
{
  // 使用者 2026-09-16：家裡有成員食量特別小 → 每位各自設，不是全家一個倍率。
  eq(newMember().appetite, 'normal', '新成員預設普通');
  eq(APPETITES, ['small', 'normal', 'big'], '三種：小／普通／大');
  eq([APPETITE_FACTORS.small, APPETITE_FACTORS.normal, APPETITE_FACTORS.big], [0.8, 1, 1.25], '係數 0.8／1／1.25');
  eq(appetiteOf({ appetite: 'small' }), 0.8, '小 → 0.8');
  eq(appetiteOf({ appetite: 'big' }), 1.25, '大 → 1.25');
  eq(appetiteOf({}), 1, '舊資料沒有這個欄位 → 當普通（匯進來的舊備份不該被當成食量 0）');
  eq(appetiteOf(undefined), 1, '連成員都沒有 → 當普通');
  const old = { ...newMember() };
  delete old.appetite;
  old.name = '舊備份的人';
  eq(validateMember(old), [], '舊備份（沒有食量欄位）照樣驗得過');
  ok(validateMember({ ...newMember(), name: 'x', appetite: '超大' }).some((e) => e.includes('食量')), '亂填的食量會被擋下');
}

done('membertest');

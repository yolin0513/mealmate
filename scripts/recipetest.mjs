// 食譜資料與驗證器（npm run recipetest）。
//
// 守的事：
//   · 每道內建食譜每個食材都解析到食藥署編號、克數 > 0、步驟 ≥ 3
//   · 素葷分流的結構：三軌各有食材、有 split 步驟、順序對
//   · 素的菜沒有葷食材；可分流的菜葷食材只在 meat 軌
//   · 標籤由食材推導（青蔥 → 五辛、鯛魚 → 海鮮…）
//   · data/recipes.json 跟現在重建的一模一樣（改食譜忘了 build 會紅）
//   · 驗證器本身有對照組：七種故意壞掉的食譜每一種都被抓到

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ok, eq, section, done, everyOf, noneOf, detects } from './tap.mjs';
import { loadContext, buildRecipes, summarize, outputFor } from './build-recipes.mjs';
import { validateRecipe } from '../js/recipeschema.js';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const { ctx, idx, foodsVersion } = loadContext();
const { recipes, errors } = buildRecipes(path.join(ROOT, 'data/recipes'), ctx);

section('內建食譜全部通過驗證');
eq(errors, [], '沒有任何一道食譜有驗證錯誤');
const s = summarize(recipes);
// M5 的數量門檻（PLAN §8「上線前要有的量」）：主菜 80、配菜 50、湯 25、早餐 10、主食 6，
// 而且主菜裡素食成員吃得到的（nativeVeg ＋ splittable）要 ≥ 45 —— 家裡有吃素的人才排得滿一週。
ok(s.count >= 170, `${s.count} 道（≥ 170）`);
ok((s.roles.main ?? 0) >= 80, `主菜 ${s.roles.main} 道（≥ 80）`);
ok((s.roles.side ?? 0) >= 50, `配菜 ${s.roles.side} 道（≥ 50）`);
ok((s.roles.soup ?? 0) >= 25, `湯 ${s.roles.soup} 道（≥ 25）`);
ok((s.roles.breakfast ?? 0) >= 10, `早餐 ${s.roles.breakfast} 道（≥ 10）`);
ok((s.roles.staple ?? 0) >= 6, `主食 ${s.roles.staple} 道（≥ 6）`);
ok((s.vegModes.nativeVeg ?? 0) >= 8, `素的 ${s.vegModes.nativeVeg} 道（≥ 8）`);
ok((s.vegModes.splittable ?? 0) >= 8, `可分流的 ${s.vegModes.splittable} 道（≥ 8）`);
const vegFriendlyMains = recipes.filter((r) => r.role === 'main' && r.vegMode !== 'meatOnly');
ok(vegFriendlyMains.length >= 45, `素食成員吃得到的主菜 ${vegFriendlyMains.length} 道（≥ 45）`);

section('每個食材都對到食藥署編號');
const allIngredients = recipes.flatMap((r) => r.ingredients.map((ing) => ({ recipe: r.id, ...ing })));
ok(allIngredients.length >= 150, `（母體）${allIngredients.length} 個食材列`);
everyOf(allIngredients, (ing) => idx.byId.has(ing.food), '每個食材的 food 都是 foods.json 裡存在的整合編號');
everyOf(allIngredients, (ing) => /^[A-Z]\d+$/.test(ing.food), '存的是編號（英文字母＋數字），不是口語詞');
everyOf(allIngredients, (ing) => typeof ing.grams === 'number' && ing.grams > 0, '克數都 > 0');
everyOf(recipes, (r) => r.steps.length >= 3, '每道都 ≥ 3 步');
everyOf(recipes.filter((r) => r.role !== 'staple'), (r) => r.ingredients.some((ing) => !ing.pantry), '主食以外每道至少一個非常備品食材（不然購物清單會是空的；米是常備品所以主食除外）');

section('素葷分流的結構');
const splittable = recipes.filter((r) => r.vegMode === 'splittable');
ok(splittable.length >= 8, `（母體）${splittable.length} 道可分流`);
everyOf(splittable, (r) => ['base', 'veg', 'meat'].every((t) => r.ingredients.some((ing) => ing.track === t)), '三軌各至少一個食材');
everyOf(splittable, (r) => r.steps.some((st) => st.stage === 'split'), '都有 split 步驟');
everyOf(splittable, (r) => {
  const at = r.steps.findIndex((st) => st.stage === 'split');
  return r.steps.every((st, i) => (st.stage === 'base' ? i < at : st.stage === 'split' ? true : i > at));
}, 'base 都在 split 前、veg／meat 都在 split 後');
everyOf(splittable, (r) => r.ingredients.filter((ing) => ing.track !== 'meat').every((ing) => {
  const f = idx.byId.get(ing.food);
  return !['肉類', '魚貝類'].includes(f.cat);
}), 'base 與 veg 軌沒有任何肉類／魚貝類食材');
const nativeVeg = recipes.filter((r) => r.vegMode === 'nativeVeg');
ok(nativeVeg.length >= 8, `（母體）${nativeVeg.length} 道素`);
everyOf(nativeVeg, (r) => !r.tags.includes('meat') && !r.tags.includes('seafood'), '素的菜沒有 meat／seafood 標籤');
everyOf(recipes.filter((r) => r.vegMode !== 'splittable'), (r) => r.ingredients.every((ing) => ing.track === 'base') && r.steps.every((st) => st.stage === 'base'), '不可分流的菜只有 base 軌與 base 階段');

section('標籤由食材推導');
const byId = new Map(recipes.map((r) => [r.id, r]));
ok(byId.get('r-tomato-egg')?.tags.includes('allium') && byId.get('r-tomato-egg')?.tags.includes('egg'), '番茄炒蛋（有青蔥、雞蛋）→ 五辛＋蛋', JSON.stringify(byId.get('r-tomato-egg')?.tags));
ok(!byId.get('r-tomato-egg')?.tags.includes('meat'), '番茄炒蛋沒有 meat');
ok(byId.get('r-steamed-fish')?.tags.includes('seafood') && byId.get('r-steamed-fish')?.proteins.includes('fish'), '清蒸鯛魚 → 海鮮、蛋白質來源 fish', JSON.stringify(byId.get('r-steamed-fish')));
ok(byId.get('r-ginger-bok-choy')?.tags.length === 0, '薑絲炒青江菜沒有任何標籤（全素不含五辛可吃）', JSON.stringify(byId.get('r-ginger-bok-choy')?.tags));
ok(byId.get('r-cabbage-pork-stirfry')?.proteins.includes('pork'), '高麗菜炒肉片的蛋白質來源含 pork');
ok(byId.get('r-clam-loofah-split')?.proteins.includes('shellfish'), '蛤蜊絲瓜 → shellfish');
ok(byId.get('r-mapo-tofu-split')?.proteins.includes('soy') && byId.get('r-mapo-tofu-split')?.proteins.includes('pork'), '麻婆豆腐同時有 soy 與 pork');

section('data/recipes.json 是最新的');
const committed = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/recipes.json'), 'utf8'));
const { generatedAt, ...committedNoDate } = committed;
eq(committedNoDate, outputFor(recipes, foodsVersion), 'data/recipes.json 跟現在重建的一模一樣（忘了 npm run build-recipes 會紅）');
ok(/^\d{4}-\d{2}-\d{2}$/.test(generatedAt), `有產生日期 ${generatedAt}`);

section('驗證器對照組：壞掉的食譜每一種都被抓到');
const good = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/recipes/r-cabbage-pork-stirfry.json'), 'utf8'));
const goodVeg = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/recipes/r-tomato-egg.json'), 'utf8'));
const clone = (o) => JSON.parse(JSON.stringify(o));
const broken = {
  假編號: (() => { const r = clone(good); r.ingredients[0].food = 'Z9999999'; return r; })(),
  缺meat食材: (() => { const r = clone(good); r.ingredients = r.ingredients.filter((i) => i.track !== 'meat'); return r; })(),
  素的菜放豬肉: (() => { const r = clone(goodVeg); r.ingredients.push({ food: '豬絞肉', label: '豬絞肉', grams: 100, track: 'base' }); return r; })(),
  葷食材放進base軌: (() => { const r = clone(good); r.ingredients.find((i) => i.track === 'meat').track = 'base'; return r; })(),
  // 下面三個順序錯誤各自只違反**一條**規則 —— 反例若同時踩到兩條，拿掉其中一條檢查時
  // 另一條會順便擋住，突變就不會紅（StockDiary 踩過：反例太弱被別條規則順便擋掉）。
  veg步驟排在split前: (() => { const r = clone(good); const st = r.steps; r.steps = [st[0], st[3], st[1], st[2], st[4]]; return r; })(),
  base步驟排在split後: (() => { const r = clone(good); const st = r.steps; r.steps = [st[0], st[2], st[3], st[1], st[4]]; return r; })(),
  meat步驟排在split前: (() => { const r = clone(good); const st = r.steps; r.steps = [st[0], st[4], st[1], st[2], st[3]]; return r; })(),
  克數是0: (() => { const r = clone(good); r.ingredients[0].grams = 0; return r; })(),
  只有兩步: (() => { const r = clone(goodVeg); r.steps = r.steps.slice(0, 2); return r; })(),
  缺split步驟: (() => { const r = clone(good); r.steps = r.steps.filter((st) => st.stage !== 'split'); return r; })(),
  splitServings加起來不等於servings: (() => { const r = clone(good); r.splitServings = { veg: 2, meat: 3 }; return r; })(),
  可分流卻沒有splitServings: (() => { const r = clone(good); delete r.splitServings; return r; })(),
  不分流的菜帶splitServings: (() => { const r = clone(goodVeg); r.splitServings = { veg: 1, meat: 3 }; return r; })(),
  meat軌沒有葷食材: (() => { const r = clone(good); r.ingredients.find((i) => i.track === 'meat').food = '鮮香菇'; return r; })(),
};
const invalid = (r) => validateRecipe(r, ctx).errors.length > 0;
detects(invalid, {
  shouldHit: Object.values(broken),
  shouldMiss: [good, goodVeg, JSON.parse(fs.readFileSync(path.join(ROOT, 'data/recipes/r-white-rice.json'), 'utf8'))],
}, `驗證器抓得到 ${Object.keys(broken).length} 種壞法（${Object.keys(broken).join('、')}），也放行好的`);
for (const [name, r] of Object.entries(broken)) {
  const errs = validateRecipe(r, ctx).errors;
  ok(errs.length > 0, `${name} → ${errs[0] ?? '（沒有錯誤訊息）'}`);
}

// 用真的 ctx（食材解析、食材標籤），只覆蓋要放寬的旗標
const validate = (r, over = {}) => validateRecipe(r, { ...ctx, ...over });

section('使用者自己加的菜：越少必填越好，但硬底線不放');
// 使用者回報：長輩想加「現成的滷雞腳」，步驟不到 3 步、時間是 0 分鐘，卻被擋下來。
{
  const readyMade = {
    id: 'r-user-feet', name: '滷雞腳（現成）', role: 'side', servings: 4, time: 0, method: 'cold',
    vegMode: 'meatOnly', texture: 'normal', season: [], source: 'user',
    ingredients: [{ food: '雞腳', label: '滷雞腳', grams: 300 }],
    steps: [{ text: '盛盤上桌' }],
  };
  const relaxed = validate(readyMade, { relaxRequired: true, allowMissingGrams: true });
  eq(relaxed.errors, [], `現成的菜過得了（1 步、0 分鐘）：${JSON.stringify(relaxed.errors)}`);
  eq(relaxed.recipe.time, 0, '時間就是 0，不會被改成 1');
  eq(relaxed.recipe.steps.length, 1, '步驟就是 1 步');

  // 對照：內建食譜仍然要求 3 步、時間 ≥ 1
  const strict = validate(readyMade, {});
  ok(strict.errors.length >= 2, `（對照）同一道菜用內建食譜的標準會被擋（${strict.errors.length} 個問題）`);
  ok(strict.errors.some((e) => /3 步/.test(e)), '內建仍要求 3 步');
  ok(strict.errors.some((e) => /time/.test(e)), '內建仍要求 time ≥ 1');

  // 兩步、短句子也可以
  const twoStep = validate({ ...readyMade, steps: [{ text: '退冰' }, { text: '上桌' }] }, { relaxRequired: true, allowMissingGrams: true });
  eq(twoStep.errors, [], '兩個字的步驟（「上桌」）也收');
  // 完全沒步驟還是要擋
  const noStep = validate({ ...readyMade, steps: [] }, { relaxRequired: true, allowMissingGrams: true });
  ok(noStep.errors.some((e) => /至少要寫 1 個步驟/.test(e)), '一步都沒有還是會擋，而且講人話');
  // 負的時間要擋
  ok(validate({ ...readyMade, time: -5 }, { relaxRequired: true, allowMissingGrams: true }).errors.some((e) => /0 或正整數/.test(e)), '負的時間會擋，訊息講「現成的菜填 0」');
}

section('驗證訊息要講人話，不可以丟術語給使用者');
{
  // 使用者原話：「meatOnly 的菜裡沒有任何葷食材」這段文字不知道是什麼意思
  const vegAsMeat = {
    id: 'r-user-x', name: '燙青菜', role: 'side', servings: 2, time: 5, method: 'boil',
    vegMode: 'meatOnly', texture: 'normal', season: [], source: 'user',
    ingredients: [{ food: '高麗菜', label: '高麗菜', grams: 200 }],
    steps: [{ text: '燙熟盛盤' }],
  };
  const e = validate(vegAsMeat, { relaxRequired: true, allowMissingGrams: true }).errors;
  ok(e.length >= 1, `（前提）這道會被擋：${e.join('｜')}`);
  const msg = e.find((x) => /誰能吃|葷/.test(x)) ?? '';
  ok(/沒有肉或海鮮/.test(msg), `訊息講的是「沒有肉或海鮮」而不是欄位名：「${msg}」`);

  // 所有會給使用者看到的訊息都不可以出現這些程式術語
  const JARGON = ['meatOnly', 'nativeVeg', 'splittable', 'splitServings', 'vegMode', 'servings', '軌', 'track'];
  const cases = [
    vegAsMeat,
    { ...vegAsMeat, vegMode: 'splittable', splitServings: { veg: 1, meat: 9 } },
    { ...vegAsMeat, vegMode: 'nativeVeg', ingredients: [{ food: '雞腿', label: '雞腿', grams: 200 }] },
    { ...vegAsMeat, ingredients: [{ food: '不存在的東西', label: '？', grams: 10 }] },
    { ...vegAsMeat, vegMode: 'splittable', splitServings: { veg: 1, meat: 1 } },
  ];
  const allMsgs = cases.flatMap((c) => validate(c, { relaxRequired: true, allowMissingGrams: true }).errors);
  ok(allMsgs.length >= 5, `（母體）${allMsgs.length} 則訊息`);
  noneOf(allMsgs, (m) => JARGON.some((j) => m.includes(j)), `沒有一則訊息出現程式術語（${JARGON.join('、')}）`);
  everyOf(allMsgs, (m) => m.length >= 6, '每一則都寫成句子，不是欄位名加代碼');
}

section('放寬的是必填，不是資料完整性');
{
  // 硬底線 1：食材一定要解析到食藥署編號，否則營養算不出來
  const badFood = {
    id: 'r-user-y', name: '神祕料理', role: 'side', servings: 2, time: 0, method: 'cold',
    vegMode: 'nativeVeg', texture: 'normal', season: [], source: 'user',
    ingredients: [{ food: 'zzz不存在zzz', label: '？', grams: 10 }],
    steps: [{ text: '上桌' }],
  };
  const e1 = validate(badFood, { relaxRequired: true, allowMissingGrams: true }).errors;
  ok(e1.some((m) => /找不到/.test(m)), `查不到的食材仍然擋下來：「${e1.find((m) => /找不到/.test(m))}」`);

  // 硬底線 2：素葷分軌仍然正確 —— 素的菜裡不可以有肉
  const meatInVeg = { ...badFood, ingredients: [{ food: '雞腿', label: '雞腿', grams: 200 }] };
  ok(validate(meatInVeg, { relaxRequired: true, allowMissingGrams: true }).errors.some((m) => /是葷的/.test(m)),
    '標成「素」卻放雞腿 → 仍然擋下來（素食成員吃到肉是紅線）');

  // 硬底線 3：可分流的菜，葷食材只能放葷那鍋
  const wrongTrack = {
    ...badFood, vegMode: 'splittable', servings: 2, splitServings: { veg: 1, meat: 1 },
    ingredients: [{ food: '高麗菜', label: '高麗菜', grams: 100, track: 'base' }, { food: '雞腿', label: '雞腿', grams: 100, track: 'veg' }],
  };
  ok(validate(wrongTrack, { relaxRequired: true, allowMissingGrams: true }).errors.some((m) => /葷的/.test(m)),
    '把雞腿放到素食那鍋 → 仍然擋下來');
}

done('recipetest');

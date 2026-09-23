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
import { validateRecipe, USER_DEFAULT_STEP, tagsOfFood, proteinGroupOf, PROCESSED_CATS, HIGH_PROTEIN_PER_100G, HIGH_PROTEIN_PER_SERVING } from '../js/recipeschema.js';
import { fitsDiet, versionFor } from '../js/members.js';
import { proteinDishMatch, starFoods } from '../js/planner.js';
import { estimate } from '../js/nutrition.js';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const { ctx, idx, foodsVersion } = loadContext();
const { recipes, errors } = buildRecipes(path.join(ROOT, 'data/recipes'), ctx);

section('內建食譜全部通過驗證');
eq(errors, [], '沒有任何一道食譜有驗證錯誤');
const s = summarize(recipes);
// 數量門檻。M5 是 PLAN §8 的 170 道（主菜 80、配菜 50、湯 25）；2026-09-14 使用者要求「多加一些有份量的菜」
// 補到 217 道（主菜 102、配菜 56、湯 34），門檻跟著墊高，退化會紅。
// 主菜裡素食成員吃得到的（nativeVeg ＋ splittable）要 ≥ 55 —— 補的多半是葷菜，素食保障不能被稀釋。
ok(s.count >= 248, `${s.count} 道（≥ 248；2026-09-21 補了 9 道全素配菜／湯與 2 道台式現成早餐）`);
ok((s.roles.main ?? 0) >= 100, `主菜 ${s.roles.main} 道（≥ 100）`);
ok((s.roles.side ?? 0) >= 62, `配菜 ${s.roles.side} 道（≥ 62；2026-09-21 補了 6 道全素無五辛的）`);
ok((s.roles.soup ?? 0) >= 37, `湯 ${s.roles.soup} 道（≥ 37；2026-09-21 補了 3 道全素無五辛的）`);
ok((s.roles.breakfast ?? 0) >= 41, `早餐道數門檻：早餐 ${s.roles.breakfast} 道（≥ 41；2026-09-18 補了 6 道有主食的，2026-09-19 再補 14 道，2026-09-21 補了 2 道台式現成的）`);
ok((s.roles.staple ?? 0) >= 6, `主食 ${s.roles.staple} 道（≥ 6）`);
ok((s.vegModes.nativeVeg ?? 0) >= 8, `素的 ${s.vegModes.nativeVeg} 道（≥ 8）`);
ok((s.vegModes.splittable ?? 0) >= 8, `可分流的 ${s.vegModes.splittable} 道（≥ 8）`);
const vegFriendlyMains = recipes.filter((r) => r.role === 'main' && r.vegMode !== 'meatOnly');
ok(vegFriendlyMains.length >= 55, `素食成員吃得到的主菜 ${vegFriendlyMains.length} 道（≥ 55）`);

section('主菜有份量、有變化（使用者回報：不要都只是豆腐或炒青菜）');
{
  // 2026-09-14 使用者原話：「多加一些稍微沒那麼健康的料理…像是燉牛肉或味噌湯之類，不要都只是豆腐或炒青菜」。
  // 守的是「池子裡真的有」—— 蛋白質來源與烹法都要夠多樣，排出來的一週才不會每天都是同一種口感。
  const mains = recipes.filter((r) => r.role === 'main');
  const withProtein = (p) => mains.filter((r) => r.proteins.includes(p)).length;
  const byMethod = (m) => mains.filter((r) => r.method === m).length;
  ok(withProtein('beef') >= 12, `含牛肉的主菜 ${withProtein('beef')} 道（≥ 12；補之前只有 7 道）`);
  ok(withProtein('chicken') >= 14, `含雞肉的主菜 ${withProtein('chicken')} 道（≥ 14）`);
  ok(withProtein('pork') >= 25, `含豬肉的主菜 ${withProtein('pork')} 道（≥ 25）`);
  ok(mains.filter((r) => r.proteins.includes('fish') || r.proteins.includes('shellfish')).length >= 25, `含魚貝的主菜 ${mains.filter((r) => r.proteins.includes('fish') || r.proteins.includes('shellfish')).length} 道（≥ 25）`);
  ok(byMethod('braise') >= 35, `燉／滷的主菜 ${byMethod('braise')} 道（≥ 35）`);
  ok(byMethod('pan') >= 10, `煎的主菜 ${byMethod('pan')} 道（≥ 10）`);
  ok(byMethod('bake') >= 5, `烤的主菜 ${byMethod('bake')} 道（≥ 5）`);
  ok(byMethod('steam') >= 5, `蒸的主菜 ${byMethod('steam')} 道（≥ 5）`);
  const plainMains = mains.filter((r) => r.proteins.every((p) => p === 'soy'));
  ok(plainMains.length / mains.length <= 0.2, `（量餘裕）只靠豆製品或完全沒有蛋白質來源的主菜佔 ${Math.round(plainMains.length / mains.length * 100)}%（${plainMains.length}/${mains.length}，≤ 20%）`);

  const MISO = idx.byId.get('P1200101');
  ok(MISO && MISO.name === '味噌', '（前提）味噌的編號是 P1200101');
  const misoSoups = recipes.filter((r) => r.role === 'soup' && r.ingredients.some((i) => i.food === 'P1200101'));
  ok(misoSoups.length >= 6, `味噌湯 ${misoSoups.length} 道（≥ 6）：${misoSoups.map((r) => r.name).join('、')}`);

  // 使用者 2026-09-13 定的規則：不為了收錄食譜放寬「每個食材都要解析得到編號」，而米酒查不到 —— 所以內建食譜不用酒。
  // 但「啤酒」其實查得到（飲料類 R9900102），光靠解析不到擋不住；三杯、紅燒這種菜又最容易順手寫進去。
  const texts = recipes.map((r) => ({ name: r.name, text: [r.name, r.notes ?? '', ...r.ingredients.map((i) => i.label), ...r.steps.map((st) => st.text)].join('｜') }));
  ok(texts.length === recipes.length && texts.every((t) => t.text.length > 20), `（母體）${texts.length} 道的名稱、食材、步驟文字`);
  // 「這道不用米酒」這種否定句要先拿掉（麻油薑燒雞就是這樣寫的），剩下的才算用到酒。
  const usesAlcohol = (t) => /酒/.test(t.replace(/不(用|加|放)[^，。；｜]{0,6}酒/g, ''));
  ok(!usesAlcohol('這道不用米酒，靠麻油與薑的香氣。') && usesAlcohol('加醬油、糖與一大匙米酒'), '（判準對照）「不用米酒」不算、「加一大匙米酒」算');
  ok(texts.some((t) => /不用米酒/.test(t.text)), '（前提）池子裡真的有寫「不用米酒」的菜，上面那條否定句的排除有樣本');
  noneOf(texts, (t) => usesAlcohol(t.text), '內建食譜的名稱、食材、步驟、備註都沒有用到酒（「不用米酒」這種否定句不算）',
    texts.filter((t) => usesAlcohol(t.text)).map((t) => t.name).join('、'));

  // 奶油在食藥署分類是「油脂類」，分類推不出是奶製品；foodtags 要明列，不然全素的家人會被排到奶油燉雞的素版。
  const butterIds = ['M0900101', 'M0900201', 'M0900301'];
  const withButter = recipes.filter((r) => r.ingredients.some((i) => butterIds.includes(i.food)));
  ok(withButter.length >= 3, `（母體）${withButter.length} 道用到奶油`);
  everyOf(withButter, (r) => !fitsDiet(r, 'vegan') && !fitsDiet(r, 'veganNoAllium'), '用到奶油的菜，全素的家人都吃不到（素版也不行）',
    withButter.filter((r) => fitsDiet(r, 'vegan')).map((r) => r.name).join('、'));
  everyOf(withButter.filter((r) => r.vegMode !== 'meatOnly'), (r) => fitsDiet(r, 'lactoOvo'), '（對照）蛋奶素的家人照樣吃得到 —— 上面那條不是因為這些菜本來就沒人能吃');
}

section('有主食、吃得飽的早餐（2026-09-18 第 8 項：水果優格那種吃不飽）');
{
  const FILLING = ['r-veg-egg-fried-rice', 'r-cabbage-egg-fried-noodles', 'r-tomato-egg-noodle-soup', 'r-pumpkin-millet-congee', 'r-taro-congee-split', 'r-radish-egg-rice-ball'];
  const byIdR = new Map(recipes.map((r) => [r.id, r]));
  const added = FILLING.map((id) => byIdR.get(id));
  everyOf(FILLING, (id) => byIdR.get(id)?.role === 'breakfast', `新增的 ${FILLING.length} 道都在、而且是早餐`);
  // 「有主食」：食材裡有穀物類／澱粉類，或麵條（食藥署歸在加工調理類）
  const isStapleFood = (id) => { const f = idx.byId.get(id); return !!f && (f.cat === '穀物類' || f.cat === '澱粉類' || /麵條|饅頭|吐司/.test(f.name)); };
  const stapleGrams = (r) => r.ingredients.filter((i) => isStapleFood(i.food)).reduce((a, i) => a + i.grams, 0) / r.servings;
  everyOf(added, (r) => stapleGrams(r) >= 40, `每一道每人至少 40 克主食類食材（${added.map((r) => `${r.name} ${Math.round(stapleGrams(r))}`).join('、')}）`);
  everyOf(added, (r) => r.includesStaple === true, '每一道都標了「含主食」');
  everyOf(added, (r) => r.ingredients.every((i) => idx.byId.has(i.food)), '每個食材都對到食藥署編號');
  // 食藥署資料本身缺的欄位（小米沒有糖、膽固醇）照規則標「部分未計入」、不寫 0；223 道裡原本就有 35 道這樣。
  // 這裡守的是畫面預設顯示與最常留意的四欄一定算得出來。
  everyOf(added, (r) => { const e = estimate(r, idx, { version: r.vegMode === 'splittable' ? 'veg' : 'all' }).perServing; return ['kcal', 'protein', 'carb', 'sodium'].every((k) => e[k] != null); }, '每一道的熱量、蛋白質、醣、鈉都估得出來');
  ok(added.filter((r) => r.time <= 20).length >= 3, `平日早餐 20 分鐘內做得完的有 ${added.filter((r) => r.time <= 20).length} 道（≥ 3）`);
  everyOf(added, (r) => r.time <= 40, '全部在週末早餐的 40 分鐘內');
  eq(byIdR.get('r-radish-egg-rice-ball').tags.includes('processed'), true, '菜脯蛋飯糰標成醃漬（食藥署名稱是「蘿蔔乾」，每 100 克鈉三千多毫克）');
  ok(added.filter((r) => fitsDiet(r, 'veganNoAllium')).length >= 1, '全素的家人也至少吃得到一道（南瓜小米粥）');
  ok(added.filter((r) => fitsDiet(r, 'vegan')).length >= 2, '五辛素的家人至少吃得到兩道');
  const breakfasts = recipes.filter((r) => r.role === 'breakfast');
  const filling = breakfasts.filter((r) => stapleGrams(r) >= 40);
  ok(filling.length >= 15, `早餐 ${breakfasts.length} 道裡，每人有 40 克以上主食類的 ${filling.length} 道（≥ 15；補之前 19 道裡只有 9 道）`);
  const words = ['健康', '降', '控制', '療效', '治療', '建議', '應該'];
  noneOf(added.flatMap((r) => [r.name, ...r.ingredients.map((i) => i.label), ...r.steps.map((st) => st.text)]), (t) => words.some((w) => t.includes(w)), '名稱、食材、步驟都沒有禁用詞');
}

section('早餐再補 14 道：全素 10 道、台式葷食 4 道（2026-09-19，Yolin：「好，請葷素都補」）');
{
  const VEGAN = ['r-bf-greens-tofu-skin-misua', 'r-bf-tomato-tofu-noodle-soup', 'r-bf-edamame-corn-fried-rice', 'r-bf-tofu-skin-seaweed-rice-ball',
    'r-bf-cabbage-rice-noodles', 'r-bf-banana-soymilk-pancake', 'r-bf-miso-tofu-rice-soup', 'r-bf-sesame-cold-noodles',
    'r-bf-cabbage-tofu-pancake', 'r-bf-mushroom-tofu-skin-sticky-rice'];
  const TAIWAN = ['r-bf-radish-cake-egg', 'r-bf-pork-floss-egg-crepe', 'r-bf-salty-soymilk-youtiao', 'r-bf-traditional-rice-ball'];
  const byIdR = new Map(recipes.map((r) => [r.id, r]));
  const vegan = VEGAN.map((id) => byIdR.get(id)).filter(Boolean);
  const taiwan = TAIWAN.map((id) => byIdR.get(id)).filter(Boolean);
  eq([vegan.length, taiwan.length], [10, 4], '（母體）全素 10 道、台式 4 道都在');
  everyOf([...vegan, ...taiwan], (r) => r.role === 'breakfast', '全部是早餐');
  // 全素而且不吃五辛的家人吃得到 —— 這一批就是為了他們補的（補之前他們只吃得到 6 道早餐，平日只有 3 道）
  everyOf(vegan, (r) => fitsDiet(r, 'veganNoAllium'), '全素那 10 道，全素（不吃蛋、奶、五辛）的家人都吃得到',
    vegan.filter((r) => !fitsDiet(r, 'veganNoAllium')).map((r) => r.name).join('、'));
  // Yolin 核准的是「至少 6 道」；實際補了 8 道，門檻守實際值，少一道就紅
  ok(vegan.filter((r) => r.time <= 20).length >= 8, `全素那批平日 20 分鐘內做得完的有 ${vegan.filter((r) => r.time <= 20).length} 道（≥ 8；核准的下限是 6）`);
  everyOf([...vegan, ...taiwan], (r) => r.time <= 40, '全部在週末早餐的 40 分鐘內');
  const breakfasts = recipes.filter((r) => r.role === 'breakfast');
  const veganBf = breakfasts.filter((r) => fitsDiet(r, 'veganNoAllium'));
  ok(veganBf.length >= 16 && veganBf.filter((r) => r.time <= 20).length >= 11,
    `全素的家人吃得到的早餐 ${veganBf.length} 道（≥ 16）、平日做得完的 ${veganBf.filter((r) => r.time <= 20).length} 道（≥ 11）`);
  // 台式那 4 道用到蘿蔔糕、蛋餅皮、肉鬆、油條、蝦皮 —— 只給吃葷的家人
  everyOf(taiwan, (r) => r.vegMode === 'meatOnly', '台式那 4 道都標成純葷');
  everyOf(taiwan, (r) => ['lactoOvo', 'ovo', 'lacto', 'vegan', 'veganNoAllium', 'lactoOvoNoAllium'].every((d) => !fitsDiet(r, d)), '台式那 4 道，任何一種素食的家人都吃不到');
  const words = ['健康', '降', '控制', '療效', '治療', '建議', '應該'];
  noneOf([...vegan, ...taiwan].flatMap((r) => [r.name, ...r.ingredients.map((i) => i.label), ...r.steps.map((st) => st.text)]), (t) => words.some((w) => t.includes(w)), '名稱、食材、步驟都沒有禁用詞');
}

section('加工品照食藥署的「內容物描述」判葷素（2026-09-19：分類看不出來，要明列）');
{
  // 這些都是「加工調理食品」「糕餅點心」「調味料」類，分類推不出肉、海鮮、蛋、奶、五辛；成分寫在食藥署原始資料的內容物描述裡。
  // 沒明列的話：冷凍蛋餅皮（豬油）做的蛋餅會被當成素的、咖哩塊（奶粉）的素版會排給全素的家人。
  const tagsOf = (id) => { const f = idx.byId.get(id); return f ? tagsOfFood(f, ctx.foodTags) : new Set(); };
  const EXPECT = [
    ['Q0100401', '冷藏廣式蘿蔔糕（豬肉、火腿、蝦米、蔥）', ['meat', 'seafood', 'allium']],
    ['R2700301', '冷凍蛋餅皮（豬油、蔥）', ['meat', 'allium']],
    ['R5600201', '豬肉酥', ['meat']],
    ['R4400301', '韓式泡菜（魚露、大蒜、蔥、洋蔥）', ['seafood', 'allium']],
    ['Q1000101', '土司（乳粉）', ['dairy']],
    ['P0200501', '咖哩塊（奶粉）', ['dairy']],
  ];
  everyOf(EXPECT, ([id]) => idx.byId.has(id), '（母體）六樣都在食材資料庫裡');
  for (const [id, label, want] of EXPECT) {
    const got = tagsOf(id);
    ok(want.every((t) => got.has(t)), `${label}：標了 ${want.join('、')}（實際 ${[...got].join('、') || '沒有'}）`);
  }
  // 真的影響到誰吃得到：用到這些食材的菜
  const uses = (id) => recipes.filter((r) => r.ingredients.some((i) => i.food === id && i.track !== 'meat'));
  const toast = uses('Q1000101');
  ok(toast.length >= 5, `（母體）${toast.length} 道早餐用到土司`);
  everyOf(toast, (r) => !fitsDiet(r, 'ovo') && !fitsDiet(r, 'vegan') && !fitsDiet(r, 'veganNoAllium'), '用到土司的菜，不吃奶的家人（蛋素、五辛素、全素）都吃不到',
    toast.filter((r) => fitsDiet(r, 'ovo')).map((r) => r.name).join('、'));
  ok(toast.some((r) => fitsDiet(r, 'lactoOvo')), '（對照）蛋奶素的家人照樣吃得到土司的菜 —— 上面那條不是因為這些菜本來就沒人能吃');
  const curry = uses('P0200501');
  ok(curry.length >= 2, `（母體）${curry.length} 道咖哩的共用軌用到咖哩塊`);
  everyOf(curry, (r) => !fitsDiet(r, 'vegan') && !fitsDiet(r, 'ovo'), '咖哩塊（奶粉）做的咖哩，不吃奶的家人吃不到素版',
    curry.filter((r) => fitsDiet(r, 'vegan') || fitsDiet(r, 'ovo')).map((r) => r.name).join('、'));
  everyOf(curry, (r) => fitsDiet(r, 'lactoOvo'), '（對照）蛋奶素的家人照樣吃得到咖哩的素版');
  // 成分沒寫的加工品（油條、燒餅、水煎包）無從判斷：內建食譜只能把它們放在純葷的菜裡，素食的家人才不會吃到來路不明的油
  const UNKNOWN = ['R3000101', 'R2700401', 'R2800301'];
  const withUnknown = recipes.filter((r) => r.ingredients.some((i) => UNKNOWN.includes(i.food)));
  ok(withUnknown.length >= 2, `（母體）${withUnknown.length} 道用到成分沒寫的加工品（油條…）`);
  everyOf(withUnknown, (r) => r.vegMode === 'meatOnly', '用到成分沒寫的加工品的菜都是純葷的', withUnknown.filter((r) => r.vegMode !== 'meatOnly').map((r) => r.name).join('、'));
}

section('豆芽是蔬菜：不因為名稱裡有「黃豆」「黑豆」就算豆製品（2026-09-19，Yolin：「豆芽菜也是蔬菜類」）');
{
  const SPROUTS = ['E7700401', 'E7700402', 'E7700501'];   // 黃豆芽、黃豆芽(有機)、黑豆芽：蔬菜類裡名稱命中豆製品規則的全部三筆
  const sprouts = SPROUTS.map((id) => idx.byId.get(id));
  ok(sprouts.every((f) => f?.cat === '蔬菜類' && /黃豆|黑豆/.test(f.name)), `（前提）三筆都是蔬菜類、名稱裡有「黃豆」或「黑豆」：${sprouts.map((f) => f?.name).join('、')}`);
  everyOf(sprouts, (f) => proteinGroupOf(f, new Set()) === null, '黃豆芽、黑豆芽不算豆製品（蔬菜類不走名稱規則）');
  const SOY = { R4700901: '傳統豆腐', R4700202: '五香豆干', H1150201: '豆漿(無糖)', H1100101: '毛豆仁' };
  everyOf(Object.entries(SOY), ([id, name]) => idx.byId.get(id)?.name === name && proteinGroupOf(idx.byId.get(id), new Set()) === 'soy', '（對照）傳統豆腐、五香豆干、無糖豆漿、毛豆仁仍是豆製品');
}

section('使用者自己的食譜：加工品的葷素由他說了算（2026-09-21，Yolin：「有些蛋餅皮有加豬油是葷的，但也有素的蛋餅皮」）');
{
  const uctx = { resolve: ctx.resolve, foodTags: ctx.foodTags, allowMissingGrams: true, relaxRequired: true };
  const CREPE = 'R2700301';  // 冷凍蛋餅皮：加工調理食品，資料庫標了 meat（豬油）＋ allium（蔥）
  const BACON = 'R5100801';  // 培根：加工調理食品，只有 meat
  const crepe = idx.byId.get(CREPE);
  ok(!!crepe && PROCESSED_CATS.has(crepe.cat) && tagsOfFood(crepe, ctx.foodTags).has('meat') && tagsOfFood(crepe, ctx.foodTags).has('allium'),
    `（前提）冷凍蛋餅皮是加工品類（${crepe?.cat}）、資料庫標了肉與五辛：${[...tagsOfFood(crepe, ctx.foodTags)].join('、')}`);
  const userDish = (over = {}) => ({
    id: 'r-user-crepe', name: '素蛋餅', role: 'breakfast', servings: 2, time: 10, method: 'pan', vegMode: 'nativeVeg',
    texture: 'normal', season: [], source: 'user', vegModeConfirmed: true,
    ingredients: [{ food: CREPE, label: '蛋餅皮', grams: 100, track: 'base' }, { food: '高麗菜', label: '高麗菜', grams: 100, track: 'base' }],
    steps: [{ stage: 'base', type: 'cook', text: '煎熟' }], ...over,
  });
  // U1 選過素葷 → 存得進去；肉的標籤不寫進這道菜，五辛的照常寫
  const u1 = validateRecipe(userDish(), uctx);
  eq(u1.errors, [], `U1 使用者選過素葷、加工品標成素 → 存得進去：${JSON.stringify(u1.errors)}`);
  // 兩件事拆成兩條，好讓兩條突變各自指得到（「不寫進去」壞掉 vs「連別的標籤一起丟」）
  eq(u1.recipe?.tags.includes('meat'), false, 'U1 肉的標籤沒寫進這道菜');
  eq(u1.recipe?.tags.includes('allium'), true, 'U1 同一樣食材的五辛標籤還在（只讓位葷素那兩個）');
  eq(u1.recipe?.proteins.includes('meat'), false, 'U1 也不拿去算蛋白質來源');
  // U2 沒選過素葷（表單預設就是「素」）→ 照舊擋，但訊息點名那樣食材、講得出下一步
  const u2 = validateRecipe(userDish({ vegModeConfirmed: false }), uctx).errors;
  ok(u2.some((e) => e.includes('蛋餅皮') && e.includes('素葷')), `U2 沒選過素葷 → 擋下，訊息點名食材並講下一步：${u2.join('｜')}`);
  noneOf(u2, (e) => /但這道菜標成「素」/.test(e), 'U2 不再丟舊的那句（同一件事只講一次）');
  // U3 原型食材照舊擋（豬絞肉是肉類，不是加工品類）
  const u3 = validateRecipe(userDish({ ingredients: [{ food: '豬絞肉', label: '豬絞肉', grams: 100, track: 'base' }] }), uctx).errors;
  ok(u3.some((e) => /是葷的/.test(e)), `U3 原型的豬絞肉標成素 → 照舊擋：${u3.join('｜')}`);
  // U4 內建食譜照舊擋
  const u4 = validateRecipe({ ...userDish(), source: 'builtin' }, { ...uctx, relaxRequired: false }).errors;
  ok(u4.some((e) => /是葷的/.test(e)), `U4 內建食譜的同一道 → 照舊擋：${u4.join('｜')}`);
  // U5 標成葷、沒有任何帶肉的食材：有加工品類 → 不擋；全是原型 → 照舊擋
  const meatOnly = (ings) => validateRecipe(userDish({ vegMode: 'meatOnly', ingredients: ings }), uctx).errors;
  eq(meatOnly([{ food: '冬粉', label: '冬粉', grams: 100, track: 'base' }, { food: '高麗菜', label: '高麗菜', grams: 100, track: 'base' }]), [], 'U5 標成葷、食材有加工品類（冬粉）→ 不擋（他買的那一款是葷的）');
  ok(meatOnly([{ food: '高麗菜', label: '高麗菜', grams: 100, track: 'base' }, { food: '毛豆仁', label: '毛豆仁', grams: 100, track: 'base' }]).some((e) => /沒有肉或海鮮/.test(e)), 'U5（對照）全是原型蔬菜、豆類 → 照舊擋');
  // U6 可分流、整道沒有肉：葷那欄有加工品類 → 不擋（對照組在上面「查不到的食材」那一段）
  const splitDish = (meatIng) => validateRecipe(userDish({
    vegMode: 'splittable', splitServings: { veg: 1, meat: 1 },
    ingredients: [{ food: '高麗菜', label: '高麗菜', grams: 100, track: 'base' }, { food: '豆干', label: '豆干', grams: 50, track: 'veg' }, meatIng],
    steps: [{ stage: 'base', type: 'cook', text: '炒香' }, { stage: 'split', type: 'split', text: '分兩鍋' }, { stage: 'veg', type: 'cook', text: '素的加豆干' }, { stage: 'meat', type: 'cook', text: '葷的加料' }],
  }), uctx).errors;
  eq(splitDish({ food: CREPE, label: '蛋餅皮', grams: 50, track: 'meat' }), [], 'U6 可分流、葷那欄是加工品類 → 不擋');
  // U7 真的排得到：被推翻的那道，全素的家人吃得到
  ok(versionFor(u1.recipe, 'vegan') !== null && versionFor(u1.recipe, 'veganNoAllium') === null,
    `U7 被推翻的那道，五辛素的家人吃得到（${versionFor(u1.recipe, 'vegan')}）；不吃五辛的仍吃不到（蛋餅皮有蔥，五辛標籤沒被動）`);
  eq(versionFor({ ...u1.recipe, tags: [...u1.recipe.tags, 'meat'] }, 'vegan'), null, 'U7（對照）同一道帶著肉的標籤時，全素的家人吃不到 —— 差別就在那個標籤');
  // U8 查不到的食材那條保守規則不變：同一道菜同時有被推翻的加工品與查不到的食材 → 全素家人仍然排不到
  const both = validateRecipe(userDish({
    ingredients: [{ food: BACON, label: '素培根', grams: 50, track: 'base' }, { food: '', label: '某牌素火腿', grams: 50, track: 'base' }],
  }), uctx);
  eq(both.errors, [], `U8（前提）推翻的加工品＋查不到的食材，選過素葷就存得進去：${JSON.stringify(both.errors)}`);
  eq([both.recipe?.tags.includes('meat'), both.recipe?.tags.includes('unresolved')], [false, true], 'U8 肉的標籤拿掉了，但查不到的那樣照舊標 unresolved');
  eq(versionFor(both.recipe, 'veganNoAllium'), null, 'U8 全素（不吃五辛）的家人仍然排不到 —— 查不到的食材那條保守規則沒被順手放寬');
  eq(versionFor(both.recipe, 'lactoOvo'), 'all', 'U8（對照）蛋、奶、五辛都吃的家人照樣吃得到');
}

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
ok(byId.get('r-ginger-bok-choy')?.tags.length === 0, '薑絲炒青江菜沒有任何標籤（全素（不吃五辛）可吃）', JSON.stringify(byId.get('r-ginger-bok-choy')?.tags));
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

  // 對照：內建食譜仍然要求 3 步、時間 ≥ 1（放寬現在跟著 source 走，所以對照組要是「不是使用者的菜」）
  const strict = validate({ ...readyMade, source: 'builtin' }, {});
  ok(strict.errors.length >= 2, `（對照）同一道菜用內建食譜的標準會被擋（${strict.errors.length} 個問題）`);
  ok(strict.errors.some((e) => /3 步/.test(e)), '內建仍要求 3 步');
  ok(strict.errors.some((e) => /time/.test(e)), '內建仍要求 time ≥ 1');

  // 兩步、短句子也可以
  const twoStep = validate({ ...readyMade, steps: [{ text: '退冰' }, { text: '上桌' }] }, { relaxRequired: true, allowMissingGrams: true });
  eq(twoStep.errors, [], '兩個字的步驟（「上桌」）也收');
  // 2026-09-14 再回報：「還是強制要求輸入步驟」—— v0.17.0 放寬到 1 步，但表單預設的那一步還是要打字（「步驟 #1 還沒寫字」）。
  // 使用者的菜可以一步都不寫。
  const noStep = validate({ ...readyMade, steps: [] }, { relaxRequired: true, allowMissingGrams: true });
  eq(noStep.errors, [], `一步都沒寫也存得進去：${JSON.stringify(noStep.errors)}`);
  eq(noStep.recipe.steps.map((s) => s.text), [USER_DEFAULT_STEP], `存的時候補一句「${USER_DEFAULT_STEP}」（今天頁的做菜順序才有東西可以列）`);
  // 表單預設就有一個空白步驟：原封不動按新增，送進來的是 [{ text: '' }]。不帶任何旗標（放寬跟著 source 走）。
  const blankStep = validate({ ...readyMade, steps: [{ stage: 'base', type: 'cook', text: '' }] }, {});
  eq(blankStep.errors, [], `表單那一步空白也存得進去：${JSON.stringify(blankStep.errors)}`);
  eq(blankStep.recipe.steps.map((s) => s.text), [USER_DEFAULT_STEP], '空白那一步不存成空字串，存成預設那一句');
  const mixedSteps = validate({ ...readyMade, steps: [{ text: '加熱' }, { text: '   ' }] }, {});
  eq(mixedSteps.errors, [], '（對照）寫了一步、多一個空白步驟也存得進去');
  eq(mixedSteps.recipe.steps.map((s) => s.text), ['加熱'], '空白的那一步略過，寫了字的照存（不補預設句）');
  // 對照：內建食譜的空白步驟、沒有步驟照樣擋
  ok(validate({ ...readyMade, source: 'builtin', time: 5, steps: [{ text: '' }, { text: '切好下鍋拌炒' }, { text: '調味後盛盤' }] }, {}).errors.some((e) => /步驟 #1 還沒寫字/.test(e)), '（對照）內建食譜的空白步驟照樣擋');
  ok(validate({ ...readyMade, source: 'builtin', time: 5, steps: [] }, {}).errors.some((e) => /步驟至少 3 步/.test(e)), '（對照）內建食譜沒有步驟照樣擋');
  // 負的時間要擋
  ok(validate({ ...readyMade, time: -5 }, { relaxRequired: true, allowMissingGrams: true }).errors.some((e) => /0 或正整數/.test(e)), '負的時間會擋，訊息講「現成的菜填 0」');
}

section('使用者自己加的菜：放寬跟著這道菜走，不靠呼叫端記得帶旗標（滷雞腳回歸）');
{
  // 2026-09-14 使用者回報：「滷雞腳」被「time（分鐘）要是 ≥1」「步驟至少 3 步」「找不到「」」「標成葷卻沒有肉」「步驟 #1 還沒寫字」擋下。
  // 那五句逐字就是「新版驗證器 ＋ 沒帶 relaxRequired 的呼叫端 ＋ 食材沒點清單」的輸出。v0.11.0 以後每一版的 store.js 都有帶旗標，
  // 所以手機上是新版的 recipeschema.js 配到舊版（v0.10.0）的 store.js。這裡照 v0.10.0 store.recipeCtx 的形狀重現。
  // 以前這條只驗「測試自己把 relaxRequired 帶進去」—— 呼叫端沒帶到的情況從來沒被測過（慣例 21）。
  const oldStoreCtx = { resolve: ctx.resolve, foodTags: ctx.foodTags, allowMissingGrams: true };
  const userDraft = {
    id: 'r-user-feet2', name: '滷雞腳', role: 'main', servings: 4, time: 0, method: 'stirfry', vegMode: 'meatOnly', texture: 'normal', season: [], source: 'user',
    ingredients: [{ food: '', label: '雞腳', grams: null, track: 'base' }], steps: [{ stage: 'base', type: 'cook', text: '加熱' }],
  };
  const viaOldStore = validateRecipe(userDraft, oldStoreCtx);
  eq(viaOldStore.errors, [], `舊版 store.js 的上下文（沒帶旗標）也存得進去：${JSON.stringify(viaOldStore.errors)}`);
  eq(viaOldStore.recipe.ingredients[0].food, 'I0420801', '沒點清單、只打「雞腳」→ 解析到雞腳(肉雞) I0420801');
  // 編輯舊食譜（2026-09-19 全面檢測補的）：當年資料庫不認得、存成 food: null＋unresolved；之後別名補上了，
  // 使用者打開編輯不碰那個框就存 —— 表單送進來的就是這個形狀，要靠名稱補解析才對得上。
  const oldSaved = validateRecipe({ ...userDraft, ingredients: [{ food: null, label: '雞腳', grams: 300, track: 'base', unresolved: true }] }, oldStoreCtx);
  eq([oldSaved.recipe?.ingredients[0].food ?? null, oldSaved.recipe?.ingredients[0].unresolved ?? false], ['I0420801', false],
    '編輯舊食譜：當年存成 food: null 的「雞腳」，現在認得了 → 對到 I0420801，也不再標成查不到');
  ok(viaOldStore.recipe.tags.includes('meat'), '雞腳被認成肉 →「標成葷卻沒有肉」不會再出現');
  eq(viaOldStore.recipe.time, 0, '時間就是 0');
  const explicitStrict = validateRecipe(userDraft, { ...oldStoreCtx, relaxRequired: false });
  ok(explicitStrict.errors.some((e) => /3 步/.test(e)) && explicitStrict.errors.some((e) => /≥1/.test(e)), '（對照）明確指定不放寬時照樣擋 —— 上面那條不是因為驗證器什麼都不檢查');
  const builtinStrict = validateRecipe({ ...userDraft, source: undefined }, oldStoreCtx);
  ok(builtinStrict.errors.some((e) => /3 步/.test(e)), '（對照）不是使用者的菜（內建食譜）沒指定就照內建標準');

  // 「找不到「名稱」＋相近名稱」現在只有內建食譜會看到（使用者的菜查不到可以存，見最後一段）
  const unknownTyped = validateRecipe({ ...userDraft, source: 'builtin', ingredients: [{ food: '', label: '豬耳朵絲', grams: 10, track: 'base' }] }, { ...oldStoreCtx, suggest: () => ['豬耳', '豬肚'] }).errors;
  ok(unknownTyped.some((e) => e.includes('找不到「豬耳朵絲」')), `（內建食譜）查不到的食材，訊息帶入打的名稱：${unknownTyped.join('｜')}`);
  ok(unknownTyped.some((e) => e.includes('相近的有：豬耳、豬肚')), '而且列出資料庫裡相近的名稱');
  const unknownUser = validateRecipe({ ...userDraft, ingredients: [{ food: '', label: '豬耳朵絲', grams: null, track: 'base' }] }, oldStoreCtx).errors;
  ok(unknownUser.some((e) => e.includes('（豬耳朵絲）') && e.includes('自己選一次')), `（使用者的菜）訊息一樣帶入名稱，改成請使用者自己選葷素：${unknownUser.join('｜')}`);
  const nothing = validateRecipe({ ...userDraft, ingredients: [{ food: '', label: '', grams: null, track: 'base' }] }, oldStoreCtx).errors;
  ok(nothing.some((e) => e.includes('還沒選是哪一種食材')), `什麼都沒打：講「還沒選是哪一種食材」：${nothing.join('｜')}`);
  noneOf(nothing, (e) => /label|缺/.test(e), '什麼都沒打時不會多一句「缺 label」（程式用語，而且跟「還沒選」講同一件事）');
  const noName = validateRecipe({ ...userDraft, ingredients: [{ food: '雞腳', label: '', grams: null, track: 'base' }] }, { ...oldStoreCtx, relaxRequired: false }).errors;
  ok(noName.some((e) => e.includes('還沒寫這個食材要顯示的名稱')), `（對照）有食材但沒名稱：用人話講缺名稱：${noName.join('｜')}`);
  const everyMsg = [...unknownTyped, ...unknownUser, ...nothing, ...explicitStrict.errors, ...builtinStrict.errors];
  ok(everyMsg.length >= 5, `（母體）${everyMsg.length} 則訊息`);
  noneOf(everyMsg, (e) => e.includes('「」'), '沒有任何一則訊息是空的引號「」', everyMsg.filter((e) => e.includes('「」')).join('｜'));
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
  // 使用者自己加的菜查不到可以存（見下一段）；**內建食譜**查不到仍然擋
  const e1 = validate({ ...badFood, source: 'builtin' }, { relaxRequired: true, allowMissingGrams: true }).errors;
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

section('使用者自己加的菜：食藥署查不到的食材也可以存，但葷素要使用者明講（紅線）');
{
  // 2026-09-14 使用者確認：真的查不到的食材（豬耳朵）讓使用者存。營養寫「未估算」、畫面講明只是部分估算；
  // **葷素一定要使用者自己選一次**（不能靠食材推斷，也不能沿用表單預設的「素」）。內建食譜照舊每個食材都要查得到。
  const base = {
    id: 'r-user-ear', name: '滷豬耳朵', role: 'side', servings: 4, time: 0, method: 'cold', vegMode: 'meatOnly', texture: 'normal', season: [], source: 'user',
    ingredients: [{ food: '', label: '豬耳朵', grams: 300 }, { food: '', label: '青蔥', grams: 20 }], steps: [{ text: '切片上桌' }],
  };
  const userCtx = { resolve: ctx.resolve, foodTags: ctx.foodTags, allowMissingGrams: true };
  eq(ctx.resolve('豬耳朵'), null, '（前提）食藥署資料庫真的查不到「豬耳朵」');
  const notConfirmed = validateRecipe(base, userCtx).errors;
  ok(notConfirmed.some((e) => e.includes('豬耳朵') && e.includes('自己選一次')), `沒自己選過葷素 → 擋下並講清楚：${notConfirmed.join('｜')}`);
  noneOf(notConfirmed, (e) => e.includes('找不到'), '使用者的菜不再用「找不到」擋下');
  const confirmed = validateRecipe({ ...base, vegModeConfirmed: true }, userCtx);
  eq(confirmed.errors, [], `自己選了「葷」→ 存得進去（肉就是那個查不到的豬耳朵，由使用者決定）：${JSON.stringify(confirmed.errors)}`);
  const ear = confirmed.recipe.ingredients[0];
  ok(ear.food === null && ear.unresolved === true && ear.label === '豬耳朵', `查不到的食材存成 food:null＋unresolved（${JSON.stringify(ear)}）`);
  eq(confirmed.recipe.ingredients[1].food, 'E23001', '（對照）同一道菜裡查得到的青蔥照樣解析');
  ok(confirmed.recipe.tags.includes('unresolved') && confirmed.recipe.vegModeConfirmed === true, '標上 unresolved，並記住使用者自己選過葷素');

  const builtin = validateRecipe({ ...base, source: 'builtin', vegModeConfirmed: true }, { ...userCtx, relaxRequired: true }).errors;
  ok(builtin.some((e) => e.includes('找不到「豬耳朵」')), `（硬底線不變）內建食譜查不到的食材照樣擋下：${builtin.join('｜')}`);

  // 素：使用者說是素的 → 蛋奶素照使用者的判斷；全素保守地不排（查不到就判斷不了蛋、奶、五辛）
  const vegDish = validateRecipe({ ...base, name: '素排', vegMode: 'nativeVeg', vegModeConfirmed: true, ingredients: [{ food: '', label: '某牌素排', grams: 100 }] }, userCtx);
  eq(vegDish.errors, [], `自己選了「素」→ 存得進去：${JSON.stringify(vegDish.errors)}`);
  eq([versionFor(vegDish.recipe, 'omni'), versionFor(vegDish.recipe, 'lactoOvo'), versionFor(vegDish.recipe, 'vegan'), versionFor(vegDish.recipe, 'veganNoAllium')], ['all', 'all', null, null],
    '查不到的「素」食材：葷、蛋奶素吃得到；全素與全素（不吃五辛）保守地不排');

  // 可分流：放葷那鍋 → 素食成員不受影響；放共用或素那鍋 → 全素保守地不排
  const splitBase = {
    ...base, name: '豬耳朵拌小黃瓜', vegMode: 'splittable', splitServings: { veg: 1, meat: 3 }, vegModeConfirmed: true,
    steps: [{ stage: 'base', text: '小黃瓜拍碎' }, { stage: 'split', type: 'split', text: '分兩盤' }, { stage: 'veg', text: '素的那盤加豆干' }, { stage: 'meat', text: '葷的那盤加豬耳朵' }],
  };
  const meatPot = validateRecipe({ ...splitBase, ingredients: [{ food: '小黃瓜', label: '小黃瓜', grams: 300, track: 'base' }, { food: '豆干', label: '豆干', grams: 100, track: 'veg' }, { food: '', label: '豬耳朵', grams: 200, track: 'meat' }] }, userCtx);
  eq(meatPot.errors, [], `可分流、查不到的食材放葷那鍋 → 整道只靠它有肉也收（使用者自己放的）：${JSON.stringify(meatPot.errors)}`);
  eq(versionFor(meatPot.recipe, 'vegan'), 'veg', '放在葷那鍋 → 全素的家人照樣吃素版');
  const vegPot = validateRecipe({ ...splitBase, ingredients: [{ food: '小黃瓜', label: '小黃瓜', grams: 300, track: 'base' }, { food: '', label: '某牌素肚', grams: 100, track: 'veg' }, { food: '豬肉片', label: '豬肉片', grams: 200, track: 'meat' }] }, userCtx);
  eq(vegPot.errors, [], `可分流、查不到的食材放素那鍋也收：${JSON.stringify(vegPot.errors)}`);
  eq([versionFor(vegPot.recipe, 'lactoOvo'), versionFor(vegPot.recipe, 'vegan')], ['veg', null], '放在素那鍋 → 蛋奶素吃素版、全素保守地不排');
  // 葷那欄用毛豆仁（豆類，原型食材）：2026-09-21 起，使用者自己的食譜只要葷那欄有一樣**加工品類**就不擋（R3），
  // 而豆干的食藥署類別正是「加工調理食品及其他類」—— 用它的話這條對照組就驗不到「整道沒有肉還標可分流」那一條了。
  const noMeatAtAll = validateRecipe({ ...splitBase, ingredients: [{ food: '小黃瓜', label: '小黃瓜', grams: 300, track: 'base' }, { food: '', label: '某牌素肚', grams: 100, track: 'veg' }, { food: '毛豆仁', label: '毛豆仁', grams: 100, track: 'meat' }] }, userCtx).errors;
  ok(noMeatAtAll.some((e) => /整道都沒有肉或海鮮/.test(e)), '（對照）查不到的食材不在葷那鍋、整道也沒別的肉 → 照樣講「其實是素的」');

  // 營養：沒算進去的食材讓每個有數字的欄位都標成部分估算；整道都查不到 → 未估算（null），不是 0
  const est = estimate(confirmed.recipe, idx, { version: 'all' });
  eq(est.unresolved, ['豬耳朵'], '估算時列出沒算進去的食材');
  ok(est.perServing.kcal != null && est.partial.kcal.includes('豬耳朵') && est.partial.protein.includes('豬耳朵'), `查得到的青蔥照算，熱量、蛋白質都標成部分估算（${Math.round(est.perServing.kcal)} kcal，＊豬耳朵）`);
  const onlyEar = validateRecipe({ ...base, vegModeConfirmed: true, ingredients: [{ food: '', label: '豬耳朵', grams: 300 }] }, userCtx).recipe;
  ok(Object.values(estimate(onlyEar, idx, { version: 'all' }).perServing).every((v) => v === null), '整道都查不到 → 每一欄都是未估算（null），不是 0');
}

section('全素無五辛的蛋白質配菜與湯（2026-09-21，SPEC_全素無五辛蛋白質配菜 R1–R3）');
{
  // 這批菜存在的理由就是「不吃五辛的全素家人吃得到，而且那一餐有蛋白質來源」。
  // 九道的 id 寫死在這裡（母體＝9，不是「至少 1」）——漏掉一道、或哪一道被改成別的角色，前提那條就會紅。
  const VEG_SIDES = ['r-edamame-corn', 'r-braised-baiye-tofu', 'r-tofu-skin-bokchoy', 'r-mien-chang-pepper', 'r-cold-tofu-strips', 'r-frozen-tofu-cabbage'];
  const VEG_SOUPS = ['r-kelp-tofu-soup', 'r-tofu-skin-cabbage-soup', 'r-edamame-corn-soup'];
  const NEW_IDS = [...VEG_SIDES, ...VEG_SOUPS];
  const byIdV = new Map(recipes.map((r) => [r.id, r]));
  const added9 = NEW_IDS.map((id) => byIdV.get(id)).filter(Boolean);
  eq(added9.length, NEW_IDS.length, `（前提）九道新菜每一道都在食譜庫裡（${added9.map((r) => r.name).join('、')}）`);
  eq(VEG_SIDES.map((id) => byIdV.get(id)?.role), Array(6).fill('side'), '（前提）六道是配菜');
  eq(VEG_SOUPS.map((id) => byIdV.get(id)?.role), Array(3).fill('soup'), '（前提）三道是湯');

  // V1 吃得到、達標、標籤乾淨
  everyOf(added9, (r) => versionFor(r, 'veganNoAllium') !== null, 'V1 九道菜，不吃五辛的全素家人每一道都吃得到',
    added9.filter((r) => versionFor(r, 'veganNoAllium') === null).map((r) => r.name).join('、'));
  const kindOf = (r) => proteinDishMatch(r, 'all', idx)?.kind ?? null;
  everyOf(added9, (r) => ['soy', 'highprotein'].includes(kindOf(r)), 'V1 九道菜每一道都算「那一餐的蛋白質來源」（豆製品或高蛋白質食材）',
    added9.map((r) => `${r.name}=${kindOf(r)}`).join('、'));
  const BAD_TAGS = ['allium', 'egg', 'dairy', 'meat', 'seafood'];
  everyOf(added9, (r) => BAD_TAGS.every((t) => !r.tags.includes(t)), 'V1 九道菜的標籤裡沒有五辛、蛋、奶、肉、海鮮',
    added9.filter((r) => BAD_TAGS.some((t) => r.tags.includes(t))).map((r) => `${r.name}${JSON.stringify(r.tags)}`).join('、'));
  everyOf(added9, (r) => r.alliumOptional !== true, 'V1 九道菜一道都沒有用「五辛可省略」這個出口（不吃五辛的人不必看但書）');
  // 對照組：既有的味噌豆腐湯就是靠 alliumOptional，證明上面那條不是恆真
  eq(byIdV.get('r-miso-tofu-soup')?.alliumOptional, true, 'V1（對照）既有的味噌豆腐湯確實是用那個出口的 —— 上面那條有分辨力');

  // V2 主角要分散（同一樣主角的菜排在一起會互相扣分，補了也救不到）
  const star1 = (r) => starFoods(r, 'all', idx)[0] ?? null;
  const sideStars = VEG_SIDES.map((id) => star1(byIdV.get(id)));
  eq(sideStars.filter(Boolean).length, 6, `（前提）六道配菜每一道都認得出主角（${sideStars.join('、')}）`);
  ok(new Set(sideStars).size >= 5, `V2 六道配菜的主角至少 5 種不同的食材（規格的門檻；實際 ${new Set(sideStars).size} 種）`);
  // 規格只要求 ≥5，實際做到 6 道全不重複。驗到 6 才抓得到「某一道的主角改成跟別道一樣」——
  // 只驗 ≥5 的話，六種掉到五種照樣綠，那條斷言就分辨不出東西。
  eq(new Set(sideStars).size, 6, 'V2 六道配菜的主角實際上完全不重複');
  const DRIED_TOFU_FAMILY = ['R4700202', 'R4700203', 'R4700301', 'R4700201'];
  ok(sideStars.filter((k) => DRIED_TOFU_FAMILY.includes(k)).length <= 1, `V2 主角是豆干家族的配菜最多 1 道（實際 ${sideStars.filter((k) => DRIED_TOFU_FAMILY.includes(k)).length} 道；池子裡已經有 8 道豆干的菜）`);
  eq(sideStars.filter((k) => k === 'R4701101').length, 0, 'V2 沒有一道的主角是小三角油豆腐（配菜、主菜各已經有一道）');
  const soupStars = VEG_SOUPS.map((id) => star1(byIdV.get(id)));
  eq(soupStars.filter((k) => k === 'R4701201').length, 0, `V2 三道湯的主角都不是嫩豆腐（既有三道豆腐湯的主角都是它）：${soupStars.join('、')}`);
  eq(new Set(soupStars).size, 3, 'V2 三道湯的主角彼此不同');
  const starCount = new Map();
  for (const k of [...sideStars, ...soupStars]) starCount.set(k, (starCount.get(k) ?? 0) + 1);
  ok(Math.max(...starCount.values()) <= 2, `V2 九道裡同一個主角最多出現 2 次（${[...starCount].map(([k, n]) => `${k}×${n}`).join('、')}）`);

  // V3 時間：湯要排得進平日晚餐（現有兩道 45–55 分的豆腐湯就是卡在這裡）
  everyOf(VEG_SOUPS.map((id) => byIdV.get(id)), (r) => r.time <= 25, 'V3 三道湯都在 25 分鐘內',
    VEG_SOUPS.map((id) => `${byIdV.get(id)?.name} ${byIdV.get(id)?.time}`).join('、'));
  ok(VEG_SIDES.filter((id) => byIdV.get(id).time <= 20).length >= 5, `V3 六道配菜裡 ${VEG_SIDES.filter((id) => byIdV.get(id).time <= 20).length} 道在 20 分鐘內（≥ 5）`);
  // 每份的豆製品克數要穩穩過門檻，不要壓線（壓線的話改個配方就掉出去了）
  const starGrams = (r) => {
    const k = star1(r);
    const ing = r.ingredients.find((i) => i.food === k);
    return ing ? ing.grams / r.servings : 0;
  };
  everyOf(added9, (r) => starGrams(r) >= 40, `V3 每一道每份的主角食材都 ≥ 40 克（${added9.map((r) => `${r.name} ${Math.round(starGrams(r))}`).join('、')}）`);
}

section('台式現成早餐：包子這一路（2026-09-21，SPEC_台式現成早餐 R1–R8）');
{
  const BAO = 'r-bf-bao-soymilk-split';
  const XLB = 'r-bf-xiaolongbao-soymilk';
  const byIdB = new Map(recipes.map((r) => [r.id, r]));
  const newBf = [BAO, XLB].map((id) => byIdB.get(id)).filter(Boolean);
  eq(newBf.length, 2, `（前提）兩道新早餐都在（${newBf.map((r) => r.name).join('、')}）`);
  // B-T1 這一路的賣點是快：買現成、蒸熱就吃
  everyOf(newBf, (r) => r.role === 'breakfast', 'B-T1 兩道都是早餐');
  everyOf(newBf, (r) => r.time <= 15, `B-T1 兩道都在 15 分鐘內（${newBf.map((r) => `${r.name} ${r.time} 分`).join('、')}）`);
  everyOf(newBf, (r) => r.includesStaple === true, 'B-T1 兩道都標了「含主食」（包子本身就是主食）');
  // B-T2 包子那道：吃葷的拿到肉包版、不吃五辛的全素家人拿到素菜包版
  const bao = byIdB.get(BAO);
  eq(bao.vegMode, 'splittable', '（前提）包子那道是可分流的');
  const baoTracks = new Set(bao.ingredients.map((i) => i.track ?? 'base'));
  ok(baoTracks.has('veg') && baoTracks.has('meat'), `（前提）素、葷兩欄各有自己的包子（${[...baoTracks].join('、')}）`);
  eq([versionFor(bao, 'omni'), versionFor(bao, 'veganNoAllium')], ['meat', 'veg'], 'B-T2 吃葷的拿肉包那一版、不吃五辛的全素家人拿素菜包那一版');
  eq(versionFor(bao, 'lactoOvo'), 'veg', 'B-T2 蛋奶素的家人也拿素菜包那一版');
  // 素菜包的葷素交給看得到包裝的人判斷（食藥署描述只寫「麵粉、蔬菜等」，看不出五辛與蛋奶）
  const vegBaoIng = bao.ingredients.find((i) => i.track === 'veg');
  ok(/全素/.test(vegBaoIng.label), `B-T2 素菜包那一樣的名稱講明要買哪一種：「${vegBaoIng.label}」`);
  // B-T4 既有守則不變：純葷那道真的只有吃葷的人吃得到
  const xlb = byIdB.get(XLB);
  eq([versionFor(xlb, 'omni'), versionFor(xlb, 'lactoOvo'), versionFor(xlb, 'veganNoAllium')], ['all', null, null],
    'B-T4 小籠包那道是純葷的：只有吃葷的家人吃得到');
  ok(xlb.tags.includes('meat'), `B-T4 而且它帶肉的標籤（${JSON.stringify(xlb.tags)}）—— 小籠包的食藥署描述寫了豬肉，標籤是照描述補的`);
}

section('高蛋白質食材的輪替群組 highprotein（2026-09-23，SPEC_高蛋白食材的輪替群組 G1–G4）');
{
  // Yolin 的一貫原則：看含量，不看名稱或分類。麵腸、麵筋份量夠 → 自己一個蛋白質群組，跟 soy 分開（麵腸是小麥、豆腐是黃豆）。
  const MIEN = 'R1700201';     // 麵腸(未調味) 20.6／100 克
  const GLUTEN = 'R1700101';   // 麵筋(未調味) 42.5
  const DRY_TOFU = 'R4700202'; // 五香豆干 19.3：含量也過門檻，但它本來就是 soy
  const byNameR = (n) => recipes.find((r) => r.name === n);
  const perServingProtein = (r, food) => {
    const ing = r.ingredients.find((i) => i.food === food && !i.pantry);
    return ing ? ing.grams / r.servings * idx.byId.get(food).n.protein / 100 : 0;
  };
  // G1 紅燒麵腸：輪替上終於有蛋白質來源
  const mien = byNameR('紅燒麵腸');
  ok(!!mien && perServingProtein(mien, MIEN) >= HIGH_PROTEIN_PER_SERVING,
    `（前提）紅燒麵腸每份從麵腸吃到 ${perServingProtein(mien, MIEN).toFixed(1)} 克蛋白質（≥ ${HIGH_PROTEIN_PER_SERVING}）`);
  eq(mien?.proteins, ['highprotein'], 'G1 紅燒麵腸的蛋白質群組是 highprotein（以前是空的，同一天兩道麵腸不會被扣分）');

  // 造假菜：用番茄炒蛋的欄位當骨架，換掉食材（青江菜墊底）
  const skel = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/recipes/r-tomato-egg.json'), 'utf8'));
  const fake = (ings) => validateRecipe({ ...skel, id: 'r-fake-hp', name: '假菜', vegMode: 'nativeVeg', servings: 4,
    ingredients: [{ food: 'E3201202', label: '青江菜', grams: 300, track: 'base' }, ...ings] }, ctx);
  // G2 克數門檻：含量夠高、吃得少 → 不算
  ok(idx.byId.get(GLUTEN).n.protein >= HIGH_PROTEIN_PER_100G, `（前提）麵筋每 100 克 ${idx.byId.get(GLUTEN).n.protein} 克，含量這一關一定過`);
  const g2few = fake([{ food: GLUTEN, label: '麵筋', grams: 40, track: 'base' }]);
  const g2many = fake([{ food: GLUTEN, label: '麵筋', grams: 60, track: 'base' }]);
  eq([g2few.errors, g2many.errors], [[], []], '（前提）兩道假菜本身都通過驗證');
  ok(!g2few.recipe.proteins.includes('highprotein'), `G2 麵筋每份 10 克（${(10 * 42.5 / 100).toFixed(2)} 克蛋白質）→ 不算：${JSON.stringify(g2few.recipe.proteins)}`);
  eq(g2many.recipe.proteins, ['highprotein'], `G2（對照）每份 15 克（${(15 * 42.5 / 100).toFixed(2)} 克）→ 算`);
  // G3 不重複加：豆干含量也過門檻，但它已經是 soy
  ok(idx.byId.get(DRY_TOFU).n.protein >= HIGH_PROTEIN_PER_100G, `（前提）五香豆干每 100 克 ${idx.byId.get(DRY_TOFU).n.protein} 克，高蛋白那一關也過`);
  eq(fake([{ food: DRY_TOFU, label: '豆干', grams: 160, track: 'base' }]).recipe.proteins, ['soy'], 'G3 豆干的菜只有 soy，不另外加 highprotein');
  // 可分流：份數照各自那一欄算（素的那一欄除以素的份數）
  const split = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/recipes/r-asparagus-squid-split.json'), 'utf8'));
  const vegServ = split.splitServings.veg;
  const splitMien = validateRecipe({ ...split, ingredients: [...split.ingredients, { food: MIEN, label: '麵腸', grams: 40 * vegServ, track: 'veg' }] }, ctx);
  ok(splitMien.errors.length === 0 && 40 * vegServ / split.servings * 20.6 / 100 < HIGH_PROTEIN_PER_SERVING,
    `（前提）可分流的假菜通過驗證；麵腸若除以總份數 ${split.servings} 只剩每份 ${(40 * vegServ / split.servings * 20.6 / 100).toFixed(1)} 克，除以素的 ${vegServ} 份是 ${(40 * 20.6 / 100).toFixed(1)} 克`);
  ok(splitMien.recipe.vegProteins.includes('highprotein') && !splitMien.recipe.meatProteins.includes('highprotein'),
    `G1b 可分流的菜：麵腸在素的那一欄 → 素版有 highprotein、葷版沒有（${JSON.stringify(splitMien.recipe.vegProteins)}／${JSON.stringify(splitMien.recipe.meatProteins)}）`);
  // G4 全部內建食譜掃一遍
  ok(recipes.length > 200, `（母體）掃了 ${recipes.length} 道內建食譜`);
  eq(recipes.filter((r) => r.proteins.includes('highprotein')).map((r) => r.name).sort(), ['紅燒麵腸', '麵腸炒青椒'].sort(),
    'G4 帶 highprotein 的內建食譜恰好是麵腸那兩道');
  const catOf = (i) => idx.byId.get(i.food)?.cat;
  const nameOf = (i) => idx.byId.get(i.food)?.name ?? '';
  const g4Control = recipes.filter((r) => r.ingredients.some((i) => !i.pantry && (catOf(i) === '菇類' || catOf(i) === '穀物類' || /芝麻|花生/.test(nameOf(i)))));
  ok(g4Control.length >= 30 && g4Control.some((r) => r.ingredients.some((i) => /乾香菇/.test(nameOf(i)))),
    `（母體）用到菇（含乾香菇）、穀物（麵、飯）、芝麻、花生的菜 ${g4Control.length} 道`);
  noneOf(g4Control, (r) => r.proteins.includes('highprotein'), 'G4（對照）乾香菇、芝麻、花生、麵條、飯的菜都沒有 highprotein',
    g4Control.filter((r) => r.proteins.includes('highprotein')).map((r) => r.name).join('、'));
}

done('recipetest');

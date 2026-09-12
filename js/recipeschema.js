// 食譜 schema 與驗證器（PLAN §3.2）。**純函式、不碰 DOM**：
// scripts/build-recipes.mjs 用它驗內建食譜並產出 data/recipes.json；
// App 在 M1 用同一支驗使用者手動新增的食譜；recipetest 用它跑對照組。
//
// 重點規則（每一條都有測試盯著）：
//   · 每個食材的 food 必須解析到 foods.json 裡存在的整合編號（可以寫口語詞，build 時換成編號）
//   · grams > 0；steps ≥ 3
//   · vegMode=splittable：食材要有 base／veg／meat 三軌各至少一個，步驟要有 split 階段，
//     而且 base 步驟都在 split 之前、veg／meat 步驟都在 split 之後
//   · vegMode=nativeVeg：任何一軌都不能有肉類／魚貝類（含蠔油、沙茶醬這種葷的調味料）
//   · vegMode=splittable：肉類／魚貝類只能在 meat 軌
//   · 標籤（五辛、蛋、奶、海鮮、肉、花生、麩質）由食材**推導**，不手寫

export const ROLES = ['main', 'side', 'soup', 'staple', 'breakfast'];
export const ROLE_LABELS = { main: '主菜', side: '配菜', soup: '湯', staple: '主食', breakfast: '早餐' };
export const VEG_MODES = ['nativeVeg', 'splittable', 'meatOnly'];
export const VEG_MODE_LABELS = { nativeVeg: '素', splittable: '可分流（一鍋兩吃）', meatOnly: '葷' };
export const TRACKS = ['base', 'veg', 'meat'];
export const TRACK_LABELS = { base: '共用', veg: '素食那鍋', meat: '葷食那鍋' };
export const STAGES = ['base', 'split', 'veg', 'meat'];
export const STAGE_LABELS = { base: '共同', split: '分流', veg: '素', meat: '葷' };
export const STEP_TYPES = ['prep', 'cook', 'split', 'serve'];
export const METHODS = ['stirfry', 'steam', 'braise', 'boil', 'soup', 'pan', 'bake', 'cold', 'rice', 'porridge'];
export const METHOD_LABELS = { stirfry: '炒', steam: '蒸', braise: '滷／燉', boil: '水煮／燙', soup: '煮湯', pan: '煎', bake: '烤', cold: '涼拌', rice: '煮飯', porridge: '煮粥' };
export const TEXTURES = ['normal', 'soft', 'minced'];
export const TEXTURE_LABELS = { normal: '一般', soft: '軟質', minced: '需剁碎' };

/** 由食藥署分類推導的食材標籤。 */
export const CAT_TAGS = {
  '肉類': 'meat',
  '魚貝類': 'seafood',
  '蛋類': 'egg',
  '乳品類': 'dairy',
};
export const TAG_LABELS = { meat: '肉', seafood: '海鮮', egg: '蛋', dairy: '奶', allium: '五辛', peanut: '花生', gluten: '麩質' };

const ID_RX = /^r-[a-z0-9-]+$/;

/**
 * 推導一個食材的標籤：分類 ＋ foodtags.json 的明列（蠔油是海鮮、蔥蒜是五辛…）。
 * foodTags 的形狀：{ seafood: [id…], meat: [id…], allium: [id…], egg: [id…], dairy: [id…], peanut: [id…], gluten: [id…] }
 */
export function tagsOfFood(food, foodTags) {
  const out = new Set();
  const byCat = CAT_TAGS[food.cat];
  if (byCat) out.add(byCat);
  for (const [tag, ids] of Object.entries(foodTags ?? {})) {
    if (Array.isArray(ids) && ids.includes(food.id)) out.add(tag);
  }
  return out;
}

/** 主要蛋白質來源（給週計畫的蛋白質輪替用）。從食藥署的正式名稱推，蛋類先判斷免得「雞蛋」被算成雞。 */
export function proteinGroupOf(food, tags) {
  if (tags.has('egg')) return 'egg';
  if (tags.has('seafood')) return /蝦|蟹|蛤|蚵|牡蠣|烏賊|花枝|透抽|章魚|干貝|扇貝|貽貝/.test(food.name) ? 'shellfish' : 'fish';
  if (tags.has('meat')) {
    if (/豬/.test(food.name)) return 'pork';
    if (/雞/.test(food.name)) return 'chicken';
    if (/牛/.test(food.name)) return 'beef';
    if (/羊/.test(food.name)) return 'lamb';
    if (/鴨|鵝/.test(food.name)) return 'duck';
    return 'meat';
  }
  if (food.cat === '豆類' || /豆腐|豆干|豆皮|豆包|豆漿|百頁|豆豉|毛豆|黃豆|黑豆/.test(food.name)) return 'soy';
  return null;
}

const isInt = (n) => Number.isInteger(n);
const isPosNum = (n) => typeof n === 'number' && Number.isFinite(n) && n > 0;

/**
 * 驗證並正規化一道食譜。
 * @param recipe 原始 JSON（食材的 food 可以是口語詞或編號）
 * @param ctx { resolve(term) → food|null, foodTags }
 * @returns { errors: string[], recipe: 正規化後（food 換成編號、補 tags／proteins） }
 */
export function validateRecipe(recipe, ctx) {
  const errors = [];
  const err = (m) => errors.push(m);
  const r = recipe ?? {};

  if (!ID_RX.test(String(r.id ?? ''))) err(`id 格式錯：${r.id}`);
  if (typeof r.name !== 'string' || !r.name.trim()) err('缺 name');
  if (!ROLES.includes(r.role)) err(`role 不在 ${ROLES.join('/')}：${r.role}`);
  if (!isInt(r.servings) || r.servings < 1) err(`servings 要是 ≥1 的整數：${r.servings}`);
  if (!isInt(r.time) || r.time < 1) err(`time（分鐘）要是 ≥1 的整數：${r.time}`);
  if (!METHODS.includes(r.method)) err(`method 不在 ${METHODS.join('/')}：${r.method}`);
  if (!VEG_MODES.includes(r.vegMode)) err(`vegMode 不在 ${VEG_MODES.join('/')}：${r.vegMode}`);
  if (!TEXTURES.includes(r.texture)) err(`texture 不在 ${TEXTURES.join('/')}：${r.texture}`);
  if (!Array.isArray(r.season) || r.season.some((m) => !isInt(m) || m < 1 || m > 12)) err('season 要是 1–12 的月份陣列（空陣列＝全年）');

  const ingredients = Array.isArray(r.ingredients) ? r.ingredients : [];
  if (ingredients.length === 0) err('沒有食材');
  const steps = Array.isArray(r.steps) ? r.steps : [];
  if (steps.length < 3) err(`步驟至少 3 步，只有 ${steps.length}`);

  const tags = new Set();
  const proteins = new Set();
  const tracksSeen = new Set();
  const normIngredients = ingredients.map((ing, i) => {
    const where = `食材 #${i + 1}（${ing?.label ?? '?'}）`;
    if (typeof ing?.label !== 'string' || !ing.label.trim()) err(`${where} 缺 label`);
    if (!isPosNum(ing?.grams)) err(`${where} grams 要 > 0：${ing?.grams}`);
    const track = ing?.track ?? 'base';
    if (!TRACKS.includes(track)) err(`${where} track 不在 ${TRACKS.join('/')}：${track}`);
    if (r.vegMode !== 'splittable' && track !== 'base') err(`${where} 只有 splittable 的菜可以有 ${track} 軌`);
    tracksSeen.add(track);
    const food = ctx.resolve(ing?.food);
    if (!food) err(`${where} 的 food「${ing?.food}」解析不到食藥署編號`);
    let fTags = new Set();
    if (food) {
      fTags = tagsOfFood(food, ctx.foodTags);
      for (const t of fTags) tags.add(t);
      const pg = proteinGroupOf(food, fTags);
      if (pg) proteins.add(pg);
      const nonVeg = fTags.has('meat') || fTags.has('seafood');
      if (nonVeg && r.vegMode === 'nativeVeg') err(`${where} 是葷的（${food.name}），但這道菜標成 nativeVeg`);
      if (nonVeg && r.vegMode === 'splittable' && track !== 'meat') err(`${where} 是葷的（${food.name}），在 splittable 的菜裡只能放 meat 軌，現在在 ${track}`);
    }
    if (ing?.buy != null) {
      if (!isPosNum(ing.buy.qty) || typeof ing.buy.unit !== 'string' || !ing.buy.unit) err(`${where} buy 要是 {qty>0, unit}`);
    }
    return {
      food: food ? food.id : ing?.food,
      label: ing?.label,
      grams: ing?.grams,
      track,
      ...(ing?.pantry ? { pantry: true } : {}),
      ...(ing?.buy ? { buy: { qty: ing.buy.qty, unit: ing.buy.unit } } : {}),
      ...(ing?.note ? { note: String(ing.note) } : {}),
    };
  });

  if (r.vegMode === 'splittable') {
    for (const t of TRACKS) if (!tracksSeen.has(t)) err(`splittable 的菜缺 ${t} 軌的食材`);
    if (!tags.has('meat') && !tags.has('seafood')) err('splittable 的菜 meat 軌裡沒有任何葷食材，那它其實是素的');
  }
  if (r.vegMode === 'meatOnly' && !tags.has('meat') && !tags.has('seafood')) err('meatOnly 的菜裡沒有任何葷食材');

  // 步驟
  const stageIdx = (s) => STAGES.indexOf(s);
  let splitAt = -1;
  steps.forEach((st, i) => {
    const where = `步驟 #${i + 1}`;
    if (typeof st?.text !== 'string' || st.text.trim().length < 4) err(`${where} 文字太短或缺`);
    const stage = st?.stage ?? 'base';
    if (!STAGES.includes(stage)) err(`${where} stage 不在 ${STAGES.join('/')}：${stage}`);
    if (!STEP_TYPES.includes(st?.type ?? 'cook')) err(`${where} type 不在 ${STEP_TYPES.join('/')}：${st?.type}`);
    if (r.vegMode !== 'splittable' && stage !== 'base') err(`${where} 只有 splittable 的菜可以有 ${stage} 階段`);
    if (stage === 'split') splitAt = splitAt < 0 ? i : splitAt;
  });
  if (r.vegMode === 'splittable') {
    const stages = steps.map((s) => s?.stage ?? 'base');
    if (splitAt < 0) err('splittable 的菜缺 split 步驟（「先盛出素食份」那一步）');
    if (!stages.includes('veg')) err('splittable 的菜缺 veg 階段的步驟');
    if (!stages.includes('meat')) err('splittable 的菜缺 meat 階段的步驟');
    if (splitAt >= 0) {
      stages.forEach((s, i) => {
        if (s === 'base' && i > splitAt) err(`步驟 #${i + 1} 是 base 卻排在 split 之後`);
        if ((s === 'veg' || s === 'meat') && i < splitAt) err(`步驟 #${i + 1} 是 ${s} 卻排在 split 之前`);
      });
    }
    void stageIdx;
  }

  const normalized = {
    id: r.id,
    name: r.name,
    role: r.role,
    servings: r.servings,
    time: r.time,
    method: r.method,
    vegMode: r.vegMode,
    texture: r.texture,
    season: r.season ?? [],
    ...(r.alliumOptional ? { alliumOptional: true } : {}),
    ...(r.notes ? { notes: String(r.notes) } : {}),
    ingredients: normIngredients,
    steps: steps.map((st) => ({ stage: st?.stage ?? 'base', type: st?.type ?? 'cook', text: st?.text })),
    tags: [...tags].sort(),
    proteins: [...proteins].sort(),
    source: r.source === 'user' ? 'user' : 'builtin',
  };
  return { errors, recipe: normalized };
}

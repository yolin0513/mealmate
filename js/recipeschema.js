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
/** 清單那種一列一道的地方用短的；詳情頁才寫全（窄螢幕＋特大字級下長標籤會比整欄還寬）。 */
export const VEG_MODE_SHORT = { nativeVeg: '素', splittable: '可分流', meatOnly: '葷' };

/** 烹調時間的文字。0 分鐘＝買回來就能吃的現成菜，不要顯示「約 0 分鐘」。 */
export function timeText(min, { short = false } = {}) {
  if (!(min > 0)) return '現成的';
  return short ? `約 ${min} 分` : `約 ${min} 分鐘`;
}
export const TRACKS = ['base', 'veg', 'meat'];
export const TRACK_LABELS = { base: '共用', veg: '素食那鍋', meat: '葷食那鍋' };
export const STAGES = ['base', 'split', 'veg', 'meat'];
export const STAGE_LABELS = { base: '共同', split: '分流', veg: '素', meat: '葷' };
export const STEP_TYPES = ['prep', 'cook', 'split', 'serve'];
export const METHODS = ['stirfry', 'steam', 'braise', 'boil', 'soup', 'pan', 'bake', 'cold', 'rice', 'porridge', 'deepfry'];
export const METHOD_LABELS = { stirfry: '炒', steam: '蒸', braise: '滷／燉', boil: '水煮／燙', soup: '煮湯', pan: '煎', bake: '烤', cold: '涼拌', rice: '煮飯', porridge: '煮粥', deepfry: '油炸' };

/** 「避開含精緻糖的菜」的門檻：糖類食材每人一份 ≥ 4 克（約一茶匙）。這是排菜用的分類，不是任何營養學上限。 */
export const SWEET_GRAMS_PER_SERVING = 4;
export const TEXTURES = ['normal', 'soft', 'minced'];
export const TEXTURE_LABELS = { normal: '一般', soft: '軟質', minced: '需剁碎' };

/** 由食藥署分類推導的食材標籤。 */
export const CAT_TAGS = {
  '肉類': 'meat',
  '魚貝類': 'seafood',
  '蛋類': 'egg',
  '乳品類': 'dairy',
};
export const TAG_LABELS = { meat: '肉', seafood: '海鮮', egg: '蛋', dairy: '奶', allium: '五辛', peanut: '花生', gluten: '麩質', sweet: '含精緻糖', processed: '加工肉／醃漬', wholegrain: '全穀雜糧', unresolved: '有食材查不到營養資料' };

/** 加工肉、醃漬品：加工調理食品類裡帶肉／海鮮的，或名稱看得出來的。給「避開加工肉與醃漬」開關用。 */
const PROCESSED_NAME_RX = /培根|火腿|香腸|臘肉|臘腸|貢丸|魚丸|肉鬆|肉乾|醃|漬|榨菜|酸菜|泡菜|鹹菜|菜脯|蘿蔔乾/; // 蘿蔔乾＝菜脯（食藥署名稱），每 100 g 鈉約 3279 mg
export function isProcessedFood(food, fTags) {
  if (PROCESSED_NAME_RX.test(food.name)) return true;
  return food.cat === '加工調理食品及其他類' && (fTags.has('meat') || fTags.has('seafood'));
}

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

/** 使用者自己加的菜一步都沒寫時，存的那一句（今天頁的做菜順序才有東西可以列）。 */
export const USER_DEFAULT_STEP = '現成的，加熱或直接盛盤即可';

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
  // 使用者自己加的菜放寬必填（1 步、0 分鐘、2 個字的步驟）。**由這道菜自己的 source 決定**，不靠呼叫端記得帶旗標。
  // 2026-09-14 使用者回報「滷雞腳」又被「≥1 分鐘」「至少 3 步」擋下：錯誤訊息逐字對得上「新版驗證器 ＋ 沒帶旗標的呼叫端」，
  // 而 v0.11.0 以後每一版的 store.js 都有帶 —— 手機上是新版的 recipeschema.js 配到舊版（v0.10.0）的 store.js。
  // 放寬只寫在呼叫端的話，只要有一支檔案舊了就整個失效。ctx.relaxRequired 仍然可以明確指定 true／false（測試用）。
  const relax = typeof ctx.relaxRequired === 'boolean' ? ctx.relaxRequired : r.source === 'user';

  if (!ID_RX.test(String(r.id ?? ''))) err(`id 格式錯：${r.id}`);
  if (typeof r.name !== 'string' || !r.name.trim()) err('缺 name');
  if (!ROLES.includes(r.role)) err(`role 不在 ${ROLES.join('/')}：${r.role}`);
  if (!isInt(r.servings) || r.servings < 1) err(`「幾人份」要填 1 以上的整數：${r.servings}`);
  // 可分流的菜要說清楚 veg／meat 兩軌各是為幾人份備的料 —— 素版、葷版的「每人一份」才算得出來
  if (r.vegMode === 'splittable') {
    const ss = r.splitServings;
    if (!ss || !isInt(ss.veg) || !isInt(ss.meat) || ss.veg < 1 || ss.meat < 1) err('「可分流」的菜要填素的幾人份、葷的幾人份（各至少 1）');
    else if (ss.veg + ss.meat !== r.servings) err(`素 ${ss.veg} 人份 ＋ 葷 ${ss.meat} 人份 ＝ ${ss.veg + ss.meat}，跟總共 ${r.servings} 人份對不起來`);
  } else if (r.splitServings != null) {
    err('只有「可分流（一鍋兩吃）」的菜才需要分素幾人份、葷幾人份');
  }
  // 現成的菜（買回來的滷雞腳、滷味）真的就是 0 分鐘。內建食譜仍然要求 ≥ 1。
  const minTime = relax ? 0 : 1;
  if (!isInt(r.time) || r.time < minTime) err(relax ? `烹調時間要填 0 或正整數（現成的菜填 0）：${r.time}` : `time（分鐘）要是 ≥1 的整數：${r.time}`);
  if (!METHODS.includes(r.method)) err(`method 不在 ${METHODS.join('/')}：${r.method}`);
  if (!VEG_MODES.includes(r.vegMode)) err(`「誰能吃」要選 ${VEG_MODES.map((v) => VEG_MODE_LABELS[v]).join('、')} 其中一個`);
  if (!TEXTURES.includes(r.texture)) err(`texture 不在 ${TEXTURES.join('/')}：${r.texture}`);
  if (!Array.isArray(r.season) || r.season.some((m) => !isInt(m) || m < 1 || m > 12)) err('season 要是 1–12 的月份陣列（空陣列＝全年）');

  const ingredients = Array.isArray(r.ingredients) ? r.ingredients : [];
  if (ingredients.length === 0) err('沒有食材');
  const rawSteps = Array.isArray(r.steps) ? r.steps : [];
  // 使用者自己加的菜，步驟可以一個字都不寫（2026-09-14 回報：現成的滷雞腳連「加熱」都不想打，表單卻卡「步驟 #1 還沒寫字」——
  // v0.17.0 放寬到「1 步」，但表單預設的那一步還是要打字）。空白的步驟直接略過；一步都沒寫的，存成 USER_DEFAULT_STEP。
  // 內建食譜仍然要求 3 步、每步寫滿（那是我自己寫的，寫滿才有參考價值）。
  const steps = relax ? rawSteps.filter((st) => typeof st?.text === 'string' && st.text.trim()) : rawSteps;
  if (!relax && steps.length < 3) err(`步驟至少 3 步，只有 ${steps.length}`);

  const tags = new Set();
  const vegTags = new Set();   // base ＋ veg 軌的標籤：素食成員實際吃到的
  const meatTags = new Set();  // base ＋ meat 軌的標籤：葷食成員實際吃到的
  const proteins = new Set();
  const tracksSeen = new Set();
  let sugarGrams = 0;          // 糖類食材總克數（推導「含精緻糖」）
  let processed = false;
  let wholegrain = false;
  const normIngredients = ingredients.map((ing, i) => {
    const typedLabel = String(ing?.label ?? '').trim();
    const where = `食材 #${i + 1}（${typedLabel || '?'}）`;
    // 名稱與食材都沒填 → 下面「還沒選是哪一種食材」那一句就夠了；只缺名稱才另外講（用人話，不講 label）
    if (!typedLabel && String(ing?.food ?? '').trim()) err(`${where} 還沒寫這個食材要顯示的名稱`);
    // 使用者手動新增的食譜可以不填克數（ctx.allowMissingGrams）：那個食材的營養就是「未估算」，不是 0。
    // 內建食譜一律要填。
    if (!isPosNum(ing?.grams)) {
      if (!(ctx.allowMissingGrams && ing?.grams == null)) err(`${where} grams 要 > 0：${ing?.grams}`);
    }
    const track = ing?.track ?? 'base';
    if (!TRACKS.includes(track)) err(`${where} 要選 ${TRACKS.map((t) => TRACK_LABELS[t]).join('、')} 其中一欄`);
    if (r.vegMode !== 'splittable' && track !== 'base') err(`${where} 分到了「${TRACK_LABELS[track]}」，但這道菜不是「可分流（一鍋兩吃）」`);
    tracksSeen.add(track);
    // 沒點清單、直接打名稱（例如在「顯示名稱」打「雞腳」）：food 是空的，就用打的名稱解析。
    // 使用者回報的「找不到「」」就是這條：food 空字串被原封不動塞進訊息裡。
    const typedFood = String(ing?.food ?? '').trim();
    const food = typedFood ? ctx.resolve(typedFood) : (typedLabel ? ctx.resolve(typedLabel) : null);
    // 查不到編號：內建食譜是**硬底線**（算不出營養）。使用者自己加的菜可以照樣存（2026-09-14 使用者確認）——
    // 那個食材的營養寫「未估算」、不當 0；而且**葷素由使用者自己選**（下面的 vegModeConfirmed），系統不猜。
    const unresolvedHere = !food && !!(typedFood || typedLabel) && r.source === 'user';
    if (!food) {
      const term = typedFood || typedLabel;
      if (!term) err(`${where} 還沒選是哪一種食材：在「找食材」打字，從清單點一筆`);
      else if (unresolvedHere) void term;   // 使用者的菜：先收下，葷素要使用者明講（見 unresolvedLabels）
      else {
        const near = typeof ctx.suggest === 'function' ? ctx.suggest(term).filter((x) => x && x !== term).slice(0, 3) : [];
        err(`${where} 在食材資料庫裡找不到「${term}」，換個常見的叫法試試（例如「雞腿」「高麗菜」）${near.length ? `；資料庫裡相近的有：${near.join('、')}` : ''}`);
      }
    }
    let fTags = new Set();
    if (food) {
      fTags = tagsOfFood(food, ctx.foodTags);
      for (const t of fTags) {
        tags.add(t);
        if (track !== 'meat') vegTags.add(t);
        if (track !== 'veg') meatTags.add(t);
      }
      const pg = proteinGroupOf(food, fTags);
      if (pg) proteins.add(pg);
      if (food.cat === '糖類' && isPosNum(ing?.grams)) sugarGrams += ing.grams;
      if (isProcessedFood(food, fTags)) processed = true;
      if (fTags.has('wholegrain')) wholegrain = true;
      const nonVeg = fTags.has('meat') || fTags.has('seafood');
      if (nonVeg && r.vegMode === 'nativeVeg') err(`${where} 是葷的（${food.name}），但這道菜標成「素」`);
      if (nonVeg && r.vegMode === 'splittable' && track !== 'meat') err(`${where} 是葷的（${food.name}），要放在「${TRACK_LABELS.meat}」那一欄，現在在「${TRACK_LABELS[track]}」`);
    }
    if (unresolvedHere) {
      // 查不到就判斷不了蛋、奶、五辛：素食成員吃得到的那一邊標 unresolved，全素的家人保守地不排（members.versionFor）
      tags.add('unresolved');
      if (track !== 'meat') vegTags.add('unresolved');
      if (track !== 'veg') meatTags.add('unresolved');
    }
    if (ing?.buy != null) {
      if (!isPosNum(ing.buy.qty) || typeof ing.buy.unit !== 'string' || !ing.buy.unit) err(`${where} buy 要是 {qty>0, unit}`);
    }
    return {
      food: food ? food.id : (unresolvedHere ? null : ing?.food),
      label: ing?.label,
      grams: isPosNum(ing?.grams) ? ing.grams : null,
      track,
      ...(unresolvedHere ? { unresolved: true } : {}),
      ...(ing?.pantry ? { pantry: true } : {}),
      ...(ing?.buy ? { buy: { qty: ing.buy.qty, unit: ing.buy.unit } } : {}),
      ...(ing?.note ? { note: String(ing.note) } : {}),
    };
  });

  // 紅線（使用者 2026-09-14 確認）：有查不到的食材時，系統判斷不了這道菜是葷是素 —— 一定要使用者自己選一次「誰能吃」，
  // 不能靠食材推斷，也不能沿用表單的預設值（預設是「素」，素食家人會被排到）。
  const unresolvedLabels = normIngredients.filter((x) => x.unresolved).map((x) => String(x.label ?? '').trim() || '?');
  if (unresolvedLabels.length && r.vegModeConfirmed !== true) {
    err(`這道菜有資料庫查不到的食材（${unresolvedLabels.join('、')}），系統判斷不了它是葷是素：請在「素葷」自己選一次（素、可分流或葷）`);
  }

  if (r.vegMode === 'splittable') {
    for (const t of TRACKS) if (!tracksSeen.has(t)) err(`「可分流（一鍋兩吃）」的菜，「${TRACK_LABELS[t]}」那一欄還沒有食材`);
    if (!tags.has('meat') && !tags.has('seafood') && !normIngredients.some((x) => x.unresolved && x.track === 'meat')) err('這道菜標成「可分流（一鍋兩吃）」，但整道都沒有肉或海鮮 —— 那它其實是素的，請把「誰能吃」改成「素」。');
  }
  // 原本寫「meatOnly 的菜裡沒有任何葷食材」—— 使用者回報看不懂。這是給人看的訊息，不是給程式看的。
  // 使用者自己選了「葷」、肉就是那個查不到的食材（滷豬耳朵）→ 由使用者決定，不擋
  if (r.vegMode === 'meatOnly' && !tags.has('meat') && !tags.has('seafood') && !unresolvedLabels.length) {
    err('這道菜標成「葷」，但食材裡沒有肉或海鮮。如果它其實吃素的人也能吃，請把「誰能吃」改成「素」。');
  }

  // 步驟
  const stageIdx = (s) => STAGES.indexOf(s);
  let splitAt = -1;
  steps.forEach((st, i) => {
    const where = `步驟 #${i + 1}`;
    const minLen = relax ? 1 : 4;   // 使用者的菜：寫了字就算一步（空白的上面已經略過）
    if (typeof st?.text !== 'string' || st.text.trim().length < minLen) err(`${where} 還沒寫字`);
    const stage = st?.stage ?? 'base';
    if (!STAGES.includes(stage)) err(`${where} 要選 ${STAGES.map((x) => STAGE_LABELS[x]).join('、')} 其中一個`);
    if (!STEP_TYPES.includes(st?.type ?? 'cook')) err(`${where} type 不在 ${STEP_TYPES.join('/')}：${st?.type}`);
    if (r.vegMode !== 'splittable' && stage !== 'base') err(`${where} 標成「${STAGE_LABELS[stage]}」，但這道菜不是「可分流（一鍋兩吃）」`);
    if (stage === 'split') splitAt = splitAt < 0 ? i : splitAt;
  });
  if (r.vegMode === 'splittable') {
    const stages = steps.map((s) => s?.stage ?? 'base');
    if (splitAt < 0) err('「可分流（一鍋兩吃）」的菜要有一個「分流」步驟（就是「先盛出素食份」那一步）');
    if (!stages.includes('veg')) err('分流之後，素的那鍋還沒有任何步驟');
    if (!stages.includes('meat')) err('分流之後，葷的那鍋還沒有任何步驟');
    if (splitAt >= 0) {
      stages.forEach((s, i) => {
        if (s === 'base' && i > splitAt) err(`步驟 #${i + 1} 是 base 卻排在 split 之後`);
        if ((s === 'veg' || s === 'meat') && i < splitAt) err(`步驟 #${i + 1} 是 ${s} 卻排在 split 之前`);
      });
    }
    void stageIdx;
  }

  // 由食材推導的排菜標籤（不是使用者手寫的）
  if (isInt(r.servings) && r.servings > 0 && sugarGrams / r.servings >= SWEET_GRAMS_PER_SERVING) { tags.add('sweet'); vegTags.add('sweet'); meatTags.add('sweet'); }
  if (processed) tags.add('processed');
  if (wholegrain) { tags.add('wholegrain'); vegTags.add('wholegrain'); meatTags.add('wholegrain'); }
  if (r.includesStaple != null && typeof r.includesStaple !== 'boolean') err('includesStaple 要是布林');

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
    ...(r.vegMode === 'splittable' && r.splitServings ? { splitServings: { veg: r.splitServings.veg, meat: r.splitServings.meat } } : {}),
    ...(r.alliumOptional ? { alliumOptional: true } : {}),
    ...(r.includesStaple ? { includesStaple: true } : {}),
    ...(r.notes ? { notes: String(r.notes) } : {}),
    ...(r.vegModeConfirmed === true ? { vegModeConfirmed: true } : {}),
    ingredients: normIngredients,
    steps: (relax && !steps.length ? [{ stage: 'base', type: 'cook', text: USER_DEFAULT_STEP }] : steps).map((st) => ({ stage: st?.stage ?? 'base', type: st?.type ?? 'cook', text: st?.text })),
    tags: [...tags].sort(),
    vegTags: r.vegMode === 'meatOnly' ? null : [...vegTags].sort(),
    meatTags: r.vegMode === 'nativeVeg' ? null : [...meatTags].sort(),
    proteins: [...proteins].sort(),
    source: r.source === 'user' ? 'user' : 'builtin',
  };
  return { errors, recipe: normalized };
}

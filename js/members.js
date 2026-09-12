// 家人模型（PLAN §3.1 members、§4.1 留意項目）。**純函式、不碰 DOM**。
//
// 紅線寫在程式碼裡而不是註解裡：
//   · 留意項目只會推導出「要顯示哪些營養欄位」（watchFields），**不會**產生任何目標值或上限
//   · 腎臟病只帶出使用者自己勾的鈉／鉀／磷／蛋白質；沒勾就什麼都不帶（不自動限鉀）
//   · 每日目標 targets 預設全部 null，由使用者輸入醫師或營養師給的數字；App 只做加總對照

export const AGE_GROUPS = ['child', 'adult', 'senior'];
export const AGE_LABELS = { child: '小孩', adult: '成人', senior: '長輩' };

export const DIETS = ['omni', 'lactoOvo', 'vegan', 'veganNoAllium'];
export const DIET_LABELS = { omni: '葷', lactoOvo: '蛋奶素', vegan: '全素', veganNoAllium: '全素不含五辛' };

export const CONDITIONS = ['diabetes', 'hypertension', 'kidney', 'lipid'];
export const CONDITION_LABELS = { diabetes: '糖尿病', hypertension: '高血壓', kidney: '腎臟病', lipid: '高血脂' };
/** 每個留意項目在畫面上帶出的欄位。腎臟病的欄位由使用者勾選，這裡是空的。 */
export const CONDITION_FIELDS = {
  diabetes: ['carb', 'sugar', 'fiber'],
  hypertension: ['sodium'],
  kidney: [],
  lipid: ['satFat', 'cholesterol'],
};
export const CONDITION_HINTS = {
  diabetes: '卡片會顯示估計的醣（碳水化合物）、糖、膳食纖維；排菜時高醣主食型的菜會往後排',
  hypertension: '卡片會顯示估計的鈉；醃漬、加工肉會往後排',
  kidney: '請勾醫師或營養師要你留意的項目；沒勾的不會顯示也不影響排序',
  lipid: '卡片會顯示估計的飽和脂肪、膽固醇；油炸、內臟、肥肉會往後排',
};
export const KIDNEY_FIELDS = ['sodium', 'potassium', 'phosphorus', 'protein'];

export const ALLERGENS = ['peanut', 'seafood', 'egg', 'dairy'];
export const ALLERGEN_LABELS = { peanut: '花生', seafood: '海鮮', egg: '蛋', dairy: '奶' };

export const MEMBER_TEXTURES = ['normal', 'soft', 'minced'];

/** 可填每日目標的欄位（由醫師或營養師給的數字；App 不提供任何預設）。 */
export const TARGET_FIELDS = ['kcal', 'carb', 'protein', 'sodium', 'potassium', 'phosphorus', 'satFat'];

export function newMember() {
  return {
    id: `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name: '',
    ageGroup: 'adult',
    diet: 'omni',
    conditions: [],
    kidneyWatch: [],
    texture: 'normal',
    allergens: [],
    targets: Object.fromEntries(TARGET_FIELDS.map((k) => [k, null])),
    createdAt: new Date().toISOString(),
  };
}

/**
 * 這位家人的卡片要顯示哪些營養欄位（依序、不重複）。
 * 腎臟病：只有 kidneyWatch 裡勾的；沒勾就沒有 —— 這是「不自動限鉀」在程式碼裡的位置。
 */
export function watchFields(member) {
  const out = [];
  const push = (k) => { if (!out.includes(k)) out.push(k); };
  for (const c of member?.conditions ?? []) {
    if (c === 'kidney') {
      for (const k of member.kidneyWatch ?? []) if (KIDNEY_FIELDS.includes(k)) push(k);
    } else {
      for (const k of CONDITION_FIELDS[c] ?? []) push(k);
    }
  }
  return out;
}

/** 全家的留意欄位聯集（有人留意就顯示）。 */
export function familyWatchFields(members) {
  const out = [];
  for (const m of members ?? []) for (const k of watchFields(m)) if (!out.includes(k)) out.push(k);
  return out;
}

export function validateMember(m) {
  const errors = [];
  if (typeof m?.name !== 'string' || !m.name.trim()) errors.push('請填暱稱');
  if (String(m?.name ?? '').length > 20) errors.push('暱稱請在 20 字以內');
  if (!AGE_GROUPS.includes(m?.ageGroup)) errors.push('年齡層不正確');
  if (!DIETS.includes(m?.diet)) errors.push('飲食型態不正確');
  if (!Array.isArray(m?.conditions) || m.conditions.some((c) => !CONDITIONS.includes(c))) errors.push('留意項目不正確');
  if (!Array.isArray(m?.kidneyWatch) || m.kidneyWatch.some((k) => !KIDNEY_FIELDS.includes(k))) errors.push('腎臟病留意欄位不正確');
  if (!MEMBER_TEXTURES.includes(m?.texture)) errors.push('質地不正確');
  if (!Array.isArray(m?.allergens) || m.allergens.some((a) => !ALLERGENS.includes(a))) errors.push('過敏原不正確');
  const t = m?.targets ?? {};
  for (const [k, v] of Object.entries(t)) {
    if (!TARGET_FIELDS.includes(k)) errors.push(`目標欄位 ${k} 不認得`);
    else if (v != null && !(typeof v === 'number' && Number.isFinite(v) && v > 0)) errors.push(`每日目標 ${k} 要是正數或留空`);
  }
  return errors;
}

/**
 * 這位家人吃這道菜的哪個版本：'all'（不分流的菜）、'veg'、'meat'；吃不了回 null。
 * 可分流的菜：葷食者吃葷版，其他人吃素版；素版要通過該飲食型態的檢查。
 */
export function versionFor(recipe, diet) {
  const split = recipe.vegMode === 'splittable';
  if (diet === 'omni') return split ? 'meat' : 'all';
  const tags = split ? (recipe.vegTags ?? []) : (recipe.tags ?? []);
  if (recipe.vegMode === 'meatOnly') return null;
  if (tags.includes('meat') || tags.includes('seafood')) return null;
  if (diet === 'lactoOvo') return split ? 'veg' : 'all';
  if (tags.includes('egg') || tags.includes('dairy')) return null;
  if (diet === 'vegan') return split ? 'veg' : 'all';
  if (diet === 'veganNoAllium') {
    if (tags.includes('allium') && !recipe.alliumOptional) return null;
    return split ? 'veg' : 'all';
  }
  return null;
}

export function fitsDiet(recipe, diet) {
  return versionFor(recipe, diet) !== null;
}

/** 這道菜（該家人吃的版本）含有哪些他的過敏原。 */
export function allergenHits(recipe, member) {
  const version = versionFor(recipe, member.diet);
  if (version === null) return [];
  const tags = version === 'veg' ? (recipe.vegTags ?? []) : version === 'meat' ? (recipe.meatTags ?? recipe.tags ?? []) : (recipe.tags ?? []);
  return (member.allergens ?? []).filter((a) => tags.includes(a));
}

/** 全家：誰吃素版、誰吃葷版、誰吃不了（給可分流的菜算份數用）。 */
export function splitByDiet(recipe, members) {
  const out = { veg: [], meat: [], none: [] };
  for (const m of members ?? []) {
    const v = versionFor(recipe, m.diet);
    if (v === 'veg') out.veg.push(m);
    else if (v === 'meat') out.meat.push(m);
    else if (v === 'all') (recipe.vegMode === 'nativeVeg' ? out.veg : out.meat).push(m);
    else out.none.push(m);
  }
  return out;
}

// 手動新增／修改我的食譜（PLAN §4.4）。跟內建食譜用同一支 validateRecipe，只放寬「克數可以不填」：
// 沒填克數的食材在營養標示裡是「未估算」，不是 0。

import { h, chips, stepper, toast } from '../ui.js';
import { setTop, render } from '../shell.js';
import { navigate } from '../router.js';
import * as store from '../store.js';
import { searchFoods } from '../foods.js';
import { validateRecipe, ROLES, ROLE_LABELS, VEG_MODES, VEG_MODE_LABELS, METHODS, METHOD_LABELS, TEXTURES, TEXTURE_LABELS, TRACKS, TRACK_LABELS, STAGES, STAGE_LABELS } from '../recipeschema.js';

const MONTHS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];

function blankIngredient(track = 'base') { return { food: '', foodName: '', label: '', grams: null, track, pantry: false }; }
function blankStep(stage = 'base') { return { stage, type: 'cook', text: '' }; }

function draftFrom(recipe, { copy = false } = {}) {
  const idx = store.foodsIndex();
  const d = JSON.parse(JSON.stringify(recipe));
  if (copy) { d.id = store.newUserRecipeId(); d.name = `${recipe.name}（我的版本）`; }
  d.ingredients = d.ingredients.map((ing) => ({ food: ing.food, foodName: idx?.byId.get(ing.food)?.name ?? '', label: ing.label, grams: ing.grams ?? null, track: ing.track ?? 'base', pantry: !!ing.pantry }));
  d.steps = d.steps.map((st) => ({ stage: st.stage ?? 'base', type: st.type ?? 'cook', text: st.text }));
  d.splitServings = d.splitServings ?? { veg: 1, meat: Math.max(1, (d.servings ?? 4) - 1) };
  d.season = d.season ?? [];
  // 複製內建食譜不算「使用者自己選過葷素」；修改自己的菜才沿用
  d.vegModeConfirmed = !copy && !!recipe.vegModeConfirmed;
  return d;
}

function newDraft() {
  return {
    id: store.newUserRecipeId(), name: '', role: 'main', servings: 4, splitServings: { veg: 1, meat: 3 }, time: 20, method: 'stirfry',
    vegMode: 'nativeVeg', vegModeConfirmed: false, texture: 'normal', season: [], alliumOptional: false,
    ingredients: [blankIngredient()], steps: [blankStep()],
  };
}

/** 草稿 → 要送給 validateRecipe 的形狀。 */
export function toRecipe(d) {
  const split = d.vegMode === 'splittable';
  return {
    id: d.id, name: d.name.trim(), role: d.role, servings: d.servings, time: d.time, method: d.method, vegMode: d.vegMode, texture: d.texture,
    season: d.season, source: 'user',
    ...(d.vegModeConfirmed ? { vegModeConfirmed: true } : {}),
    ...(split ? { splitServings: { veg: d.splitServings.veg, meat: d.servings - d.splitServings.veg } } : {}),
    ...(d.alliumOptional ? { alliumOptional: true } : {}),
    ingredients: d.ingredients.map((ing) => ({
      food: ing.food, label: ing.label.trim() || ing.foodName || String(ing.query ?? '').trim(), grams: ing.grams == null || ing.grams === '' ? null : Number(ing.grams),
      track: split ? ing.track : 'base', ...(ing.pantry ? { pantry: true } : {}),
    })),
    steps: d.steps.map((st) => ({ stage: split ? st.stage : 'base', type: st.type ?? 'cook', text: st.text.trim() })),
  };
}

export default async function recipeEditView({ id = null, from = null } = {}) {
  const idx = store.foodsIndex();
  let d;
  if (id) {
    const existing = store.userRecipes().find((r) => r.id === id);
    if (!existing) { navigate('/recipes', { replace: true }); return; }
    d = draftFrom(existing);
  } else if (from) {
    const src = store.recipeById(from);
    if (!src) { navigate('/recipes', { replace: true }); return; }
    d = draftFrom(src, { copy: true });
  } else {
    d = newDraft();
  }
  setTop({ title: id ? '修改食譜' : '新增食譜', back: true });

  const errBox = h('div', { class: 'notice err-box', hidden: true, dataset: { field: 'errors' } });
  const showErrors = (errors) => {
    errBox.hidden = errors.length === 0;
    errBox.replaceChildren(h('strong', {}, '還沒存，請先修正：'), h('ul', { class: 'err-list' }, ...errors.map((e) => h('li', {}, e))));
  };

  const nameInput = h('input', { class: 'field', type: 'text', value: d.name, placeholder: '菜名', 'aria-label': '菜名', dataset: { field: 'recipeName' } });
  nameInput.addEventListener('input', () => { d.name = nameInput.value; });
  const timeInput = h('input', { class: 'field field-inline', type: 'number', inputMode: 'numeric', min: '0', value: String(d.time), 'aria-label': '分鐘（現成的填 0）', dataset: { field: 'time' } });
  timeInput.addEventListener('input', () => { d.time = Number(timeInput.value); });
  const methodSel = h('select', { class: 'field', 'aria-label': '烹法' }, ...METHODS.map((m) => h('option', { value: m, selected: m === d.method ? 'selected' : null }, METHOD_LABELS[m])));
  methodSel.addEventListener('change', () => { d.method = methodSel.value; });

  const splitBox = h('div', { class: 'sub-block', hidden: d.vegMode !== 'splittable' });
  const servingsStep = stepper({ value: d.servings, min: 1, max: 12, label: '人份', onChange: (v) => { d.servings = v; if (d.splitServings.veg >= v) d.splitServings.veg = Math.max(1, v - 1); drawSplit(); } });
  function drawSplit() {
    splitBox.replaceChildren(
      h('p', { class: 'muted sm' }, '素食那鍋是為幾人備料？（其餘算葷食那鍋）'),
      stepper({ value: d.splitServings.veg, min: 1, max: Math.max(1, d.servings - 1), label: '素食人份', onChange: (v) => { d.splitServings.veg = v; drawSplit(); } }).node,
      h('p', { class: 'muted xs' }, `素 ${d.splitServings.veg} 人、葷 ${Math.max(0, d.servings - d.splitServings.veg)} 人`),
    );
  }
  drawSplit();

  // ---- 食材 ----
  const ingList = h('div', { class: 'edit-list', dataset: { list: 'ingredients' } });
  function ingRow(ing, i) {
    const split = d.vegMode === 'splittable';
    const picked = h('p', { class: 'sm picked', dataset: { field: 'pickedFood' } }, ing.food ? `→ ${ing.foodName || ing.food}` : '尚未選食材');
    const search = h('input', { class: 'field', type: 'search', placeholder: '找食材，例如：板豆腐', 'aria-label': `食材 ${i + 1} 搜尋`, dataset: { field: 'foodSearch' } });
    const results = h('div', { class: 'picker-results', hidden: true });
    search.addEventListener('input', () => {
      const q = search.value.trim();
      ing.query = q;   // 打在搜尋框、沒點清單也算數（存的時候用這個名稱解析）
      updateVegConfirm();
      const hits = q && idx ? searchFoods(q, idx, 8) : [];
      results.hidden = hits.length === 0;
      results.replaceChildren(...hits.map(({ food }) => h('button', {
        class: 'picker-item', type: 'button', dataset: { food: food.id },
        onclick: () => {
          ing.food = food.id; ing.foodName = food.name; ing.query = '';
          updateVegConfirm();
          if (!ing.label.trim()) { ing.label = q; labelInput.value = q; }
          picked.textContent = `→ ${food.name}（${food.cat}）`;
          results.hidden = true; search.value = '';
        },
      }, `${food.name}${food.state ? `〔${food.state}〕` : ''}`, h('span', { class: 'muted xs' }, ` ${food.cat}`))));
    });
    const labelInput = h('input', { class: 'field', type: 'text', value: ing.label, placeholder: '顯示名稱（例如：豆腐切塊）', 'aria-label': `食材 ${i + 1} 名稱`, dataset: { field: 'ingLabel' } });
    labelInput.addEventListener('input', () => {
      ing.label = labelInput.value;
      // 沒點清單、直接打名稱也可以：名稱剛好是資料庫認得的叫法（雞腳、高麗菜…）就自動對到，這裡先講出來
      if (!ing.food) {
        const hit = labelInput.value.trim() ? store.recipeCtx().resolve(labelInput.value) : null;
        picked.textContent = hit ? `→ 依名稱對到 ${hit.name}（${hit.cat}）` : '尚未選食材';
        if (!hit && labelInput.value.trim()) picked.textContent = `→ 資料庫裡查不到「${labelInput.value.trim()}」：可以照樣存，這個食材的營養會寫「未估算」`;
      }
      updateVegConfirm();
    });
    const gramsInput = h('input', { class: 'field field-inline', type: 'number', inputMode: 'decimal', min: '0', step: 'any', value: ing.grams == null ? '' : String(ing.grams), placeholder: '克數，可不填', 'aria-label': `食材 ${i + 1} 克數`, dataset: { field: 'ingGrams' } });
    gramsInput.addEventListener('input', () => { ing.grams = gramsInput.value.trim() === '' ? null : Number(gramsInput.value); });
    const pantry = h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: ing.pantry, onchange: (e) => { ing.pantry = e.target.checked; } }), ' 常備品（油鹽醬油這類）');
    const trackChips = split ? chips({ options: TRACKS.map((t) => ({ value: t, label: TRACK_LABELS[t] })), value: ing.track, name: `track-${i}`, onChange: (v) => { ing.track = v; } }) : null;
    const remove = h('button', { class: 'btn btn-danger btn-sm', type: 'button', 'aria-label': `移除食材 ${i + 1}`, onclick: () => { d.ingredients.splice(i, 1); drawIngredients(); } }, '移除');
    return h('div', { class: 'edit-row', dataset: { ingredient: String(i) } },
      h('div', { class: 'edit-row-head' }, h('strong', {}, `食材 ${i + 1}`), remove),
      search, results, picked, labelInput,
      h('div', { class: 'row-actions' }, gramsInput, h('span', { class: 'muted sm' }, 'g')),
      h('p', { class: 'muted xs' }, '沒填克數的食材，營養標示會寫「未估算」，不會當成 0。'),
      trackChips, pantry,
    );
  }
  function drawIngredients() { ingList.replaceChildren(...d.ingredients.map(ingRow)); }
  drawIngredients();

  // ---- 步驟 ----
  const stepList = h('div', { class: 'edit-list', dataset: { list: 'steps' } });
  function stepRow(st, i) {
    const split = d.vegMode === 'splittable';
    const ta = h('textarea', { class: 'field', rows: 2, placeholder: `第 ${i + 1} 步`, 'aria-label': `步驟 ${i + 1}`, dataset: { field: 'stepText' } }, st.text);
    ta.addEventListener('input', () => { st.text = ta.value; });
    const stageChips = split ? chips({ options: STAGES.map((s) => ({ value: s, label: STAGE_LABELS[s] })), value: st.stage, name: `stage-${i}`, onChange: (v) => { st.stage = v; st.type = v === 'split' ? 'split' : 'cook'; } }) : null;
    const remove = h('button', { class: 'btn btn-danger btn-sm', type: 'button', 'aria-label': `移除步驟 ${i + 1}`, onclick: () => { d.steps.splice(i, 1); drawSteps(); } }, '移除');
    return h('div', { class: 'edit-row', dataset: { step: String(i) } }, h('div', { class: 'edit-row-head' }, h('strong', {}, `步驟 ${i + 1}`), remove), stageChips, ta);
  }
  function drawSteps() { stepList.replaceChildren(...d.steps.map(stepRow)); }
  drawSteps();

  // 素葷：使用者點過就算「自己選過」。有查不到的食材時這件事是紅線（素食家人不能被系統猜的結果排到）。
  const vegChipsBox = h('div', { dataset: { field: 'vegChipsBox' } });
  const setVegMode = (v) => {
    d.vegMode = v; d.vegModeConfirmed = true;
    splitBox.hidden = v !== 'splittable';
    drawIngredients(); drawSteps(); drawVegChips(); updateVegConfirm();
  };
  function drawVegChips() {
    vegChipsBox.replaceChildren(chips({ options: VEG_MODES.map((v) => ({ value: v, label: VEG_MODE_LABELS[v] })), value: d.vegMode, name: 'vegMode', onChange: setVegMode }));
  }
  drawVegChips();
  // 有查不到的食材、使用者還沒自己選過：講清楚為什麼要選，並給三顆明確的按鈕。
  // 不能只靠上面那排 chip —— 點「已經選著的那一顆」不會觸發，預設的「素」沒辦法用點 chip 確認。
  const vegConfirm = h('div', { class: 'notice', hidden: true, dataset: { field: 'vegConfirm' } });
  function unresolvedNames() {
    const resolve = store.recipeCtx().resolve;
    return d.ingredients.map((ing) => (ing.food ? '' : (String(ing.label ?? '').trim() || String(ing.query ?? '').trim()))).filter((t) => t && !resolve(t));
  }
  function updateVegConfirm() {
    const names = unresolvedNames();
    vegConfirm.hidden = !(names.length && !d.vegModeConfirmed);
    if (vegConfirm.hidden) return;
    vegConfirm.replaceChildren(
      h('p', { class: 'sm' }, `資料庫裡查不到「${names.join('、')}」，系統判斷不了這道菜是葷是素（素食家人可能會被排到）。請自己選一次這道菜誰能吃：`),
      h('div', { class: 'row-actions' }, ...VEG_MODES.map((v) => h('button', { class: 'btn btn-sm', type: 'button', dataset: { action: 'confirmVeg', value: v }, onclick: () => setVegMode(v) }, VEG_MODE_LABELS[v]))),
    );
  }
  updateVegConfirm();

  const saveBtn = h('button', { class: 'btn btn-primary', type: 'button', dataset: { action: 'saveRecipe' } }, id ? '儲存' : '新增');
  saveBtn.addEventListener('click', async () => {
    if (saveBtn.disabled) return;
    saveBtn.disabled = true;
    try {
      const { errors, recipe } = await store.saveUserRecipe(toRecipe(d));
      if (errors.length) { showErrors(errors); errBox.scrollIntoView({ block: 'center' }); return; }
      toast(id ? '已儲存' : '已新增到「我的」');
      navigate(`/recipes/${recipe.id}`, { replace: true });
    } finally { saveBtn.disabled = false; }
  });

  render(
    h('section', { class: 'card', dataset: { card: 'editBasics' } },
      h('label', { class: 'field-label' }, '菜名'), nameInput,
      h('p', { class: 'field-label' }, '角色'),
      chips({ options: ROLES.map((v) => ({ value: v, label: ROLE_LABELS[v] })), value: d.role, name: 'role', onChange: (v) => { d.role = v; } }),
      h('p', { class: 'field-label' }, '素葷'), vegChipsBox, vegConfirm, splitBox,
      h('p', { class: 'field-label' }, '質地'),
      chips({ options: TEXTURES.map((v) => ({ value: v, label: TEXTURE_LABELS[v] })), value: d.texture, name: 'texture', onChange: (v) => { d.texture = v; } }),
      h('div', { class: 'row-actions' }, servingsStep.node),
      h('div', { class: 'row-actions' }, h('span', { class: 'muted sm' }, '烹法'), methodSel),
      h('div', { class: 'row-actions' }, h('span', { class: 'muted sm' }, '約幾分鐘'), timeInput, h('span', { class: 'muted xs' }, '現成的填 0')),
      h('p', { class: 'field-label' }, '當季月份（都不選＝全年）'),
      chips({ options: MONTHS.map((m, i) => ({ value: i + 1, label: `${m}月` })), value: d.season, multi: true, name: 'season', onChange: (v) => { d.season = [...v].sort((a, b) => a - b); } }),
    ),
    h('section', { class: 'card', dataset: { card: 'editIngredients' } },
      h('h2', { class: 'card-title' }, '食材'),
      ingList,
      h('button', { class: 'btn', type: 'button', dataset: { action: 'addIngredient' }, onclick: () => { d.ingredients.push(blankIngredient()); drawIngredients(); } }, '＋ 加一個食材'),
    ),
    h('section', { class: 'card', dataset: { card: 'editSteps' } },
      h('h2', { class: 'card-title' }, '步驟'),
      stepList,
      h('button', { class: 'btn', type: 'button', dataset: { action: 'addStep' }, onclick: () => { d.steps.push(blankStep()); drawSteps(); } }, '＋ 加一步'),
    ),
    errBox,
    h('section', { class: 'card' }, h('div', { class: 'btn-row' }, saveBtn, h('a', { class: 'btn', href: id ? `#/recipes/${id}` : '#/recipes' }, '取消'))),
  );
}

// 給 recipetest 之外的檢查用：草稿驗證（不存）
export function validateDraft(d) {
  return validateRecipe(toRecipe(d), store.recipeCtx({ allowMissingGrams: true, relaxRequired: true })).errors;
}

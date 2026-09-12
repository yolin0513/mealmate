// 新增／編輯一位家人。
//
// 紅線在表單裡的形狀：
//   · 腎臟病子項預設全不勾，說明寫「只勾醫師或營養師要你留意的」
//   · 每日目標全部預設空字串、沒有任何帶數字的 placeholder；文案寫「App 只做加總對照，不會自己建議目標」

import { h, chips, switchRow, toast, confirmDialog } from '../ui.js';
import { setTop, render } from '../shell.js';
import { navigate } from '../router.js';
import * as store from '../store.js';
import {
  newMember, AGE_GROUPS, AGE_LABELS, DIETS, DIET_LABELS, CONDITIONS, CONDITION_LABELS, CONDITION_HINTS,
  KIDNEY_FIELDS, ALLERGENS, ALLERGEN_LABELS, MEMBER_TEXTURES, TARGET_FIELDS,
} from '../members.js';
import { TEXTURE_LABELS } from '../recipeschema.js';
import { NUTRIENT_LABELS } from '../foods.js';

const DIET_HINTS = {
  omni: '什麼都吃',
  lactoOvo: '不吃肉與海鮮，吃蛋與奶',
  vegan: '不吃肉、海鮮、蛋、奶',
  veganNoAllium: '全素，而且不吃蔥、蒜、韭、洋蔥等五辛',
};

export default async function memberView(id) {
  const isNew = id == null;
  const existing = isNew ? null : store.memberById(id);
  if (!isNew && !existing) { navigate('/family', { replace: true }); return; }
  const m = existing ? JSON.parse(JSON.stringify(existing)) : newMember();
  const units = store.foodsIndex()?.units ?? {};
  setTop({ title: isNew ? '新增家人' : `編輯：${existing.name}`, back: true });

  const errBox = h('div', { class: 'notice err-box', hidden: true });
  const showErrors = (errors) => {
    errBox.hidden = errors.length === 0;
    errBox.replaceChildren(h('strong', {}, '還沒存，請先修正：'), h('ul', { class: 'err-list' }, ...errors.map((e) => h('li', {}, e))));
  };

  const nameInput = h('input', { class: 'field', type: 'text', maxLength: 20, value: m.name, placeholder: '例如：阿嬤、爸爸', 'aria-label': '暱稱', dataset: { field: 'name' } });
  nameInput.addEventListener('input', () => { m.name = nameInput.value; });

  // ---- 留意項目 ----
  const kidneySub = h('div', { class: 'sub-block', hidden: !m.conditions.includes('kidney') },
    h('p', { class: 'muted sm' }, '只勾醫師或營養師要你留意的項目；沒勾的不會顯示、也不影響排菜。'),
    chips({
      options: KIDNEY_FIELDS.map((k) => ({ value: k, label: NUTRIENT_LABELS[k] })),
      value: m.kidneyWatch, multi: true, name: 'kidneyWatch',
      onChange: (v) => { m.kidneyWatch = v; },
    }),
  );
  const conditionsBox = h('div', {});
  function redrawConditions() {
    conditionsBox.replaceChildren(...CONDITIONS.map((c) => switchRow({
      label: CONDITION_LABELS[c], hint: CONDITION_HINTS[c], checked: m.conditions.includes(c), key: `cond-${c}`,
      onChange: (on) => {
        m.conditions = on ? [...new Set([...m.conditions, c])] : m.conditions.filter((x) => x !== c);
        if (c === 'kidney') { kidneySub.hidden = !on; if (!on) m.kidneyWatch = []; }
        redrawConditions();
      },
    })), kidneySub);
  }
  redrawConditions();

  // ---- 每日目標（選填，預設空） ----
  const targetInputs = TARGET_FIELDS.map((k) => {
    const input = h('input', {
      class: 'field field-inline', type: 'number', inputMode: 'decimal', min: '0', step: 'any',
      value: m.targets?.[k] == null ? '' : String(m.targets[k]),
      'aria-label': `${NUTRIENT_LABELS[k]}每日目標`, dataset: { target: k },
    });
    input.addEventListener('input', () => {
      const v = input.value.trim();
      m.targets = { ...(m.targets ?? {}), [k]: v === '' ? null : Number(v) };
    });
    return h('div', { class: 'target-row' },
      h('span', { class: 'target-label' }, `${NUTRIENT_LABELS[k]}`),
      input,
      h('span', { class: 'muted sm' }, units[k] ?? ''),
    );
  });

  const saveBtn = h('button', { class: 'btn btn-primary', type: 'button', dataset: { action: 'saveMember' } }, isNew ? '新增' : '儲存');
  saveBtn.addEventListener('click', async () => {
    if (saveBtn.disabled) return;
    saveBtn.disabled = true;
    try {
      const { errors } = await store.saveMember(m);
      if (errors.length) { showErrors(errors); return; }
      toast(isNew ? `已新增 ${m.name.trim()}` : '已儲存');
      navigate('/family', { replace: true });
    } finally { saveBtn.disabled = false; }
  });
  const delBtn = existing ? h('button', { class: 'btn btn-danger', type: 'button', dataset: { action: 'deleteMember' } }, '刪除這位家人') : null;
  if (delBtn) delBtn.addEventListener('click', async () => {
    const yes = await confirmDialog(`要刪除「${existing.name}」嗎？只會刪掉這位家人的設定，食譜與收藏不受影響。`, { danger: true, okLabel: '刪除' });
    if (!yes) return;
    await store.deleteMember(existing.id);
    toast('已刪除');
    navigate('/family', { replace: true });
  });

  render(
    h('section', { class: 'card', dataset: { card: 'memberBasics' } },
      h('label', { class: 'field-label' }, '暱稱'), nameInput,
      h('p', { class: 'field-label' }, '年齡層'),
      chips({ options: AGE_GROUPS.map((v) => ({ value: v, label: AGE_LABELS[v] })), value: m.ageGroup, name: 'ageGroup', onChange: (v) => { m.ageGroup = v; } }),
      h('p', { class: 'field-label' }, '飲食型態'),
      chips({ options: DIETS.map((v) => ({ value: v, label: DIET_LABELS[v], hint: DIET_HINTS[v] })), value: m.diet, name: 'diet', onChange: (v) => { m.diet = v; } }),
      h('p', { class: 'field-label' }, '牙口／質地'),
      chips({ options: MEMBER_TEXTURES.map((v) => ({ value: v, label: TEXTURE_LABELS[v] })), value: m.texture, name: 'texture', onChange: (v) => { m.texture = v; } }),
      h('p', { class: 'muted xs' }, '軟質、需剁碎會讓排菜時優先挑好咬的菜，不是吞嚥評估。'),
    ),
    h('section', { class: 'card', dataset: { card: 'memberConditions' } },
      h('h2', { class: 'card-title' }, '要留意的慢性病項目'),
      h('p', { class: 'muted sm' }, '勾了只會決定卡片顯示哪些估計數字、排菜時哪些菜往後排。不會限制任何菜，也不是醫囑。'),
      conditionsBox,
    ),
    h('section', { class: 'card', dataset: { card: 'memberAllergens' } },
      h('h2', { class: 'card-title' }, '過敏原'),
      chips({ options: ALLERGENS.map((v) => ({ value: v, label: ALLERGEN_LABELS[v] })), value: m.allergens, multi: true, name: 'allergens', onChange: (v) => { m.allergens = v; } }),
      h('p', { class: 'muted xs' }, '依食材推斷，加工品成分請看包裝。'),
    ),
    h('section', { class: 'card', dataset: { card: 'memberTargets' } },
      h('h2', { class: 'card-title' }, '每日目標（選填）'),
      h('p', { class: 'muted sm' }, '若醫師或營養師有給你每日目標（例如醣類幾克），可填在這裡，App 只做加總對照，不會自己建議目標。留空就不對照。'),
      ...targetInputs,
    ),
    errBox,
    h('section', { class: 'card' }, h('div', { class: 'btn-row' }, saveBtn, delBtn, h('a', { class: 'btn', href: '#/family' }, '取消'))),
  );
}

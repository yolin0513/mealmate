// 單道食譜：食材、步驟（分流的菜標出共同／分流／素／葷）。營養估算在 M1 接上。

import { h, pill } from '../ui.js';
import { setTop, render } from '../shell.js';
import { navigate } from '../router.js';
import * as store from '../store.js';
import { eduNode } from '../edu.js';
import { ROLE_LABELS, VEG_MODE_LABELS, METHOD_LABELS, TEXTURE_LABELS, STAGE_LABELS, TRACK_LABELS, TAG_LABELS } from '../recipeschema.js';
import { vegTone } from './recipes.js';

const MONTHS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];

function seasonText(season) {
  if (!season || season.length === 0) return '全年';
  return season.map((m) => `${MONTHS[m - 1]}月`).join('、');
}

export default async function recipeView(id) {
  const r = store.recipeById(id);
  if (!r) {
    // 找不到這道菜（網址打錯、或食譜被移掉）：退回清單，不要留一個空白畫面。
    navigate('/recipes', { replace: true });
    return;
  }
  setTop({ title: r.name, back: true });

  const info = h('section', { class: 'card', dataset: { card: 'recipeInfo' } },
    h('div', { class: 'pill-row' },
      pill(ROLE_LABELS[r.role]),
      pill(VEG_MODE_LABELS[r.vegMode], vegTone(r.vegMode)),
      pill(METHOD_LABELS[r.method]),
      pill(`質地：${TEXTURE_LABELS[r.texture]}`),
      ...r.tags.map((t) => pill(TAG_LABELS[t] ?? t)),
    ),
    h('p', {}, `${r.servings} 人份 · 約 ${r.time} 分鐘 · 當季：${seasonText(r.season)}`),
    r.alliumOptional ? h('p', { class: 'muted sm' }, '蔥蒜可以省略，全素不含五辛的家人也能吃。') : null,
    r.vegMode === 'splittable' ? h('p', { class: 'muted sm' }, '這道菜先一起煮共同的部分，盛出素食份之後兩鍋各自收尾；素版與葷版的營養會分開估算。') : null,
  );

  const ingredients = h('section', { class: 'card', dataset: { card: 'recipeIngredients' } },
    h('h2', { class: 'card-title' }, '食材'),
    h('table', { class: 'ing-table' },
      h('tbody', {}, ...r.ingredients.map((ing) => h('tr', {},
        h('td', {}, ing.label, ing.pantry ? ' ' : '', ing.pantry ? pill('常備', 'muted') : null),
        h('td', { class: 'grams num' }, `${ing.grams} g`),
        r.vegMode === 'splittable' ? h('td', {}, pill(TRACK_LABELS[ing.track], ing.track === 'veg' ? 'green' : ing.track === 'meat' ? 'accent' : '')) : null,
      )))),
    h('p', { class: 'muted xs' }, '克數是估計，買菜時到「買菜」分頁看換算成幾顆、幾把。'),
  );

  const steps = h('section', { class: 'card', dataset: { card: 'recipeSteps' } },
    h('h2', { class: 'card-title' }, '步驟'),
    h('ol', { class: 'step-list' }, ...r.steps.map((st, i) => h('li', {},
      h('span', { class: 'stage-tag' + (r.vegMode === 'splittable' ? ` stage-${st.stage}` : '') },
        r.vegMode === 'splittable' ? `${i + 1} · ${STAGE_LABELS[st.stage]}` : String(i + 1)),
      h('p', {}, st.text),
    ))),
  );

  const nutrition = h('section', { class: 'card', dataset: { card: 'recipeNutrition' } },
    h('h2', { class: 'card-title' }, '估計營養標示'),
    h('p', { class: 'muted' }, '這一版尚未提供估算。下一版會依食藥署資料庫，把每個食材的克數累加成每人一份的估計值，素版與葷版分開算，並可展開看是怎麼算的。'),
    eduNode('fda.tfnd.attribution'),
  );

  render(info, ingredients, steps, nutrition);
}

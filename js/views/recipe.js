// 單道食譜：食材、步驟、估計營養標示（素版／葷版分開、人份可調、可展開「怎麼算的」）、收藏、本週想吃。

import { h, pill, chips, stepper, toast, confirmDialog, fmtNutrient, NOT_ESTIMATED } from '../ui.js';
import { setTop, render } from '../shell.js';
import { navigate } from '../router.js';
import * as store from '../store.js';
import { eduNode } from '../edu.js';
import { ROLE_LABELS, VEG_MODE_LABELS, METHOD_LABELS, TEXTURE_LABELS, STAGE_LABELS, TRACK_LABELS, TAG_LABELS, timeText } from '../recipeschema.js';
import { NUTRIENT_ORDER, NUTRIENT_LABELS } from '../foods.js';
import { estimate, servingsFor } from '../nutrition.js';
import { familyWatchFields, displayFields, versionFor, allergenHits, DIET_LABELS, ALLERGEN_LABELS } from '../members.js';
import { vegTone } from './recipes.js';

const MONTHS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];
function seasonText(season) {
  if (!season || season.length === 0) return '全年';
  return season.map((m) => `${MONTHS[m - 1]}月`).join('、');
}

export default async function recipeView(id) {
  const r = store.recipeById(id);
  if (!r) { navigate('/recipes', { replace: true }); return; }
  setTop({ title: r.name, back: true });
  const idx = store.foodsIndex();
  const units = idx?.units ?? {};
  const members = store.members();
  const watch = familyWatchFields(members);
  const isSplit = r.vegMode === 'splittable';

  // 預設看哪個版本：家裡有吃素的、而且沒有吃葷的 → 素版；否則葷版
  let version = !isSplit ? 'all' : (members.length && members.every((m) => m.diet !== 'omni') ? 'veg' : 'meat');
  let servings = servingsFor(r, version);

  // ---- 資訊 ----
  const info = h('section', { class: 'card', dataset: { card: 'recipeInfo' } },
    h('div', { class: 'pill-row' },
      pill(ROLE_LABELS[r.role]), pill(VEG_MODE_LABELS[r.vegMode], vegTone(r.vegMode)), pill(METHOD_LABELS[r.method]),
      pill(`質地：${TEXTURE_LABELS[r.texture]}`), ...r.tags.map((t) => pill(TAG_LABELS[t] ?? t)),
      r.source === 'user' ? pill('我的食譜', 'accent') : null,
    ),
    h('p', {}, `${r.servings} 人份${isSplit ? `（素 ${r.splitServings.veg}、葷 ${r.splitServings.meat}）` : ''} · ${timeText(r.time)} · 當季：${seasonText(r.season)}`),
    r.alliumOptional ? h('p', { class: 'muted sm' }, '蔥蒜可以省略，全素不含五辛的家人也能吃。') : null,
    isSplit ? h('p', { class: 'muted sm' }, '先一起煮共同的部分，盛出素食份之後兩鍋各自收尾；素版與葷版的營養分開估算，不會相加。') : null,
    ...members.map((m) => {
      const v = versionFor(r, m.diet);
      const hits = allergenHits(r, m);
      if (v === null) return h('p', { class: 'muted sm', dataset: { memberNote: m.id } }, `${m.name}（${DIET_LABELS[m.diet]}）吃不了這道。`);
      if (hits.length) return h('p', { class: 'sm warn', dataset: { memberNote: m.id } }, `${m.name}對${hits.map((a) => ALLERGEN_LABELS[a]).join('、')}過敏：這道（${v === 'veg' ? '素版' : v === 'meat' ? '葷版' : ''}）含${hits.map((a) => ALLERGEN_LABELS[a]).join('、')}，依食材推斷，加工品成分請看包裝。`);
      return null;
    }),
  );

  // ---- 收藏 ----
  const favBtn = h('button', { class: 'btn', type: 'button', dataset: { action: 'favorite' } });
  const wantBtn = h('button', { class: 'btn', type: 'button', dataset: { action: 'wantThisWeek' } });
  const drawFav = () => {
    const f = store.favorite(r.id);
    favBtn.textContent = f ? '♥ 已收藏' : '♡ 收藏';
    favBtn.className = 'btn' + (f ? ' btn-on' : '');
    wantBtn.textContent = f?.wantThisWeek ? '✓ 本週想吃' : '本週想吃';
    wantBtn.className = 'btn' + (f?.wantThisWeek ? ' btn-on' : '');
  };
  favBtn.addEventListener('click', async () => { await store.toggleFavorite(r.id); drawFav(); });
  wantBtn.addEventListener('click', async () => {
    const on = !store.favorite(r.id)?.wantThisWeek;
    const res = await store.setWantThisWeek(r.id, on);
    if (!res.ok) toast(res.reason, 3200);
    drawFav();
  });
  drawFav();
  const actions = h('section', { class: 'card', dataset: { card: 'recipeActions' } },
    h('div', { class: 'btn-row' }, favBtn, wantBtn,
      r.source === 'user'
        ? [h('a', { class: 'btn', href: `#/recipes/${r.id}/edit` }, '修改'), h('button', { class: 'btn btn-danger', type: 'button', dataset: { action: 'deleteRecipe' }, onclick: async () => {
          if (!(await confirmDialog(`要刪除「${r.name}」嗎？`, { danger: true, okLabel: '刪除' }))) return;
          await store.deleteUserRecipe(r.id); toast('已刪除'); navigate('/recipes', { replace: true });
        } }, '刪除')]
        : h('a', { class: 'btn', href: `#/recipes/new?from=${encodeURIComponent(r.id)}`, dataset: { action: 'copyRecipe' } }, '複製一份修改'),
    ),
  );

  // ---- 營養 ＋ 食材（人份與版本連動） ----
  const ingBody = h('tbody', {});
  const nutriBox = h('div', { dataset: { field: 'nutrition' } });
  const versionChips = isSplit ? chips({
    options: [{ value: 'veg', label: `素版（${r.splitServings.veg} 人份）` }, { value: 'meat', label: `葷版（${r.splitServings.meat} 人份）` }],
    value: version, name: 'version',
    onChange: (v) => { version = v; servings = servingsFor(r, v); step.set(servings); draw(); },
  }) : null;
  const step = stepper({ value: servings, min: 1, max: 12, label: '人份', onChange: (v) => { servings = v; draw(); } });

  function draw() {
    if (!idx) {
      nutriBox.replaceChildren(h('p', { class: 'muted' }, '食材營養資料尚未取得，無法估算。'));
      return;
    }
    const est = estimate(r, idx, { version, servings });
    // 食材表（依人份縮放；分流的菜只列這個版本會用到的軌）
    ingBody.replaceChildren(...r.ingredients
      .filter((ing) => !isSplit || (ing.track ?? 'base') === 'base' || (ing.track ?? 'base') === version)
      .map((ing) => {
        const divisor = (ing.track ?? 'base') === 'base' ? r.servings : servingsFor(r, version);
        const grams = ing.grams == null ? null : Math.round(ing.grams / divisor * servings);
        return h('tr', {},
          h('td', {}, ing.label, ing.pantry ? ' ' : '', ing.pantry ? pill('常備', 'muted') : null),
          h('td', { class: 'grams num' }, grams == null ? '克數未填' : `${grams} g`),
          isSplit ? h('td', {}, pill(TRACK_LABELS[ing.track ?? 'base'], ing.track === 'veg' ? 'green' : ing.track === 'meat' ? 'accent' : '')) : null,
        );
      }));

    const partialKeys = NUTRIENT_ORDER.filter((k) => est.partial[k].length > 0);
    const valueNode = (k) => h('span', { class: 'num nutri-value', dataset: { nutrient: k, partial: est.partial[k].length ? '1' : '0' } },
      fmtNutrient(est.perServing[k], units[k]), est.partial[k].length ? h('sup', { title: '有食材未計入' }, '＊') : null);
    // 預設只列熱量與蛋白質；有設留意項目的家人，那幾項一定在同一塊裡（不收進展開區）
    const fields = displayFields(members);
    const mainBlock = h('div', { class: 'watch-block', dataset: { field: 'mainFields' } },
      ...fields.map((k) => h('div', { class: 'nutri-row big' }, h('span', {}, NUTRIENT_LABELS[k]), valueNode(k))));
    const watchNote = watch.length
      ? h('p', { class: 'muted xs' }, `後面那幾項（${watch.map((k) => NUTRIENT_LABELS[k]).join('、')}）是家人設定的留意項目。`)
      : null;
    const allRows = h('div', { class: 'nutri-grid' }, ...NUTRIENT_ORDER.map((k) => h('div', { class: 'nutri-row' }, h('span', {}, NUTRIENT_LABELS[k]), valueNode(k))));

    const how = h('details', { class: 'how', dataset: { field: 'how' } },
      h('summary', {}, '怎麼算的'),
      h('table', { class: 'ing-table sm' }, h('tbody', {},
        ...est.rows.map((row) => h('tr', {},
          h('td', {}, row.label),
          h('td', { class: 'grams num' }, `${Math.round(row.gramsPerServing * 10) / 10} g／人`),
          h('td', { class: 'muted xs' }, `→ ${row.foodName}（${row.foodId}）`),
        )))),
      est.missingGrams.length ? h('p', { class: 'muted sm' }, `沒填克數、未計入：${est.missingGrams.join('、')}`) : null,
      est.unresolved.length ? h('p', { class: 'muted sm' }, `對不到食藥署條目、未計入：${est.unresolved.join('、')}`) : null,
      partialKeys.length ? h('div', { class: 'muted xs' }, h('p', {}, '＊資料庫沒有該值、未計入該欄位的食材：'),
        ...partialKeys.map((k) => h('p', {}, `${NUTRIENT_LABELS[k]}：${est.partial[k].join('、')}`))) : null,
      h('p', { class: 'muted xs' }, `每人一份 ＝ 共用食材 ÷ ${r.servings} 人 ${isSplit ? `＋ ${version === 'veg' ? '素' : '葷'}鍋食材 ÷ ${servingsFor(r, version)} 人` : ''}。未計烹調吸油與水分變化。食材資料版本 ${store.foodsVersion() ?? '—'}。`),
      eduNode('fda.tfnd.attribution'),
    );

    // replaceChildren 不像 h() 會略過 null —— 傳進去會變成畫面上一個「null」字，所以先過濾。
    nutriBox.replaceChildren(...[
      h('p', { class: 'muted sm' }, `每人一份的估計值${isSplit ? `（${version === 'veg' ? '素版' : '葷版'}）` : ''}；下方食材表是 ${servings} 人份的量。`),
      mainBlock,
      est.unresolved.length ? h('p', { class: 'notice sm', dataset: { field: 'unresolvedNotice' } }, `這道菜有食材在食藥署資料庫查不到（${est.unresolved.join('、')}），沒算進營養：上面的數字只是部分估算（標了＊），過敏原也沒辦法自動檢查。`) : null,
      watchNote,
      h('details', { class: 'how', dataset: { field: 'allFields' } }, h('summary', {}, '看全部 12 項'), allRows),
      est.rows.length === 0 ? h('p', { class: 'muted' }, `所有食材都沒填克數，整道菜${NOT_ESTIMATED}。`) : null,
      how,
    ].filter(Boolean));
  }
  draw();

  const ingredients = h('section', { class: 'card', dataset: { card: 'recipeIngredients' } },
    h('h2', { class: 'card-title' }, '食材'),
    h('div', { class: 'row-actions' }, versionChips, step.node),
    h('table', { class: 'ing-table' }, ingBody),
    h('p', { class: 'muted xs' }, '克數是估計，買菜時到「買菜」分頁看換算成幾顆、幾把。'),
  );

  const steps = h('section', { class: 'card', dataset: { card: 'recipeSteps' } },
    h('h2', { class: 'card-title' }, '步驟'),
    h('ol', { class: 'step-list' }, ...r.steps.map((st, i) => h('li', {},
      h('span', { class: 'stage-tag' + (isSplit ? ` stage-${st.stage}` : '') }, isSplit ? `${i + 1} · ${STAGE_LABELS[st.stage]}` : String(i + 1)),
      h('p', {}, st.text),
    ))),
  );

  const nutrition = h('section', { class: 'card', dataset: { card: 'recipeNutrition' } },
    h('h2', { class: 'card-title' }, '估計營養標示'),
    nutriBox,
  );

  render(info, actions, ingredients, nutrition, steps);
}

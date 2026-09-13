// 家人：成員清單、買菜日、長輩模式、備份、常駐說明、關於與資料來源。

import { h, pill, chips, switchRow, toast, confirmDialog, modal } from '../ui.js';
import { setTop, render } from '../shell.js';
import { refresh } from '../router.js';
import * as store from '../store.js';
import * as prefs from '../prefs.js';
import { eduNode } from '../edu.js';
import { APP_VERSION } from '../version.js';
import { AGE_LABELS, DIET_LABELS, CONDITION_LABELS, ALLERGEN_LABELS, watchFields } from '../members.js';
import { TEXTURE_LABELS } from '../recipeschema.js';
import { NUTRIENT_LABELS } from '../foods.js';
import { exportBundle, bundleFilename, validateImport, bundleCounts, applyImport } from '../backup.js';
import { noticeCard } from './welcome.js';

const DAY_NAMES = ['日', '一', '二', '三', '四', '五', '六'];
const STORE_LABELS = { members: '家人', settings: '設定', userRecipes: '我的食譜', favorites: '收藏', plans: '週計畫', history: '歷史', shopping: '購物清單', recipeNotes: '備註' };

function memberRow(m) {
  const fields = watchFields(m);
  return h('a', { class: 'row', href: `#/family/${m.id}`, dataset: { member: m.id } },
    h('div', { class: 'row-main' },
      h('p', { class: 'row-title' }, m.name),
      h('div', { class: 'pill-row' },
        pill(AGE_LABELS[m.ageGroup]),
        pill(DIET_LABELS[m.diet], m.diet === 'omni' ? '' : 'green'),
        ...m.conditions.map((c) => pill(CONDITION_LABELS[c], 'yellow')),
        m.texture !== 'normal' ? pill(`質地：${TEXTURE_LABELS[m.texture]}`) : null,
        ...m.allergens.map((a) => pill(`${ALLERGEN_LABELS[a]}過敏`, 'accent')),
      ),
      fields.length ? h('p', { class: 'muted xs' }, `留意：${fields.map((k) => NUTRIENT_LABELS[k]).join('、')}`) : null,
    ),
    h('div', { class: 'row-side' }, '›'),
  );
}

export default async function familyView() {
  setTop({ title: '家人', back: false });
  const members = store.members();
  const meta = store.recipesMeta();

  const membersCard = h('section', { class: 'card', dataset: { card: 'members' } },
    h('h2', { class: 'card-title' }, '家人'),
    members.length
      ? h('div', { class: 'list' }, ...members.map(memberRow))
      : h('p', { class: 'muted' }, '還沒有新增家人。先加一位：幾歲、吃葷或吃素、有沒有要留意的慢性病項目。'),
    h('a', { class: 'btn btn-primary', href: '#/family/new', dataset: { action: 'addMember' } }, '＋ 新增家人'),
  );

  // ---- 買菜日 ----
  const daysWrap = h('div', { class: 'day-row', role: 'group', 'aria-label': '買菜日' });
  const daysText = h('p', { class: 'muted sm', dataset: { field: 'shoppingDaysText' } });
  const drawDays = () => {
    const days = prefs.get('shoppingDays') ?? [];
    daysWrap.replaceChildren(...DAY_NAMES.map((name, d) => h('button', {
      class: 'day-btn' + (days.includes(d) ? ' on' : ''), type: 'button', 'aria-pressed': days.includes(d) ? 'true' : 'false',
      dataset: { day: String(d) },
      onclick: async () => {
        const cur = prefs.get('shoppingDays') ?? [];
        const next = cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort();
        await prefs.set('shoppingDays', next);
        drawDays();
      },
    }, name)));
    daysText.textContent = days.length ? `目前：星期${[...days].sort().map((d) => DAY_NAMES[d]).join('、')}` : '尚未選擇；購物清單會依買菜日分成幾張。';
  };
  drawDays();
  const daysCard = h('section', { class: 'card', dataset: { card: 'shoppingDays' } },
    h('h2', { class: 'card-title' }, '買菜日'),
    h('p', { class: 'muted sm' }, '一週買幾次、星期幾買，可複選。'),
    daysWrap, daysText,
  );

  // ---- 排菜規則：「避開」開關（預設全關；留意項目本身只降分，這裡才是使用者自己選的排除） ----
  const AVOID = [
    { key: 'sweet', label: '避開含精緻糖的菜', hint: '糖類食材每人一份約一茶匙以上的菜不排（例如糖醋、蜜汁）' },
    { key: 'processed', label: '避開加工肉與醃漬', hint: '培根、火腿、香腸、醃漬菜這類不排' },
    { key: 'fried', label: '避開油炸', hint: '烹法是油炸的菜不排' },
  ];
  const avoidNow = () => prefs.get('avoid') ?? { sweet: false, processed: false, fried: false };
  const rulesCard = h('section', { class: 'card', dataset: { card: 'rules' } },
    h('h2', { class: 'card-title' }, '排菜規則'),
    h('p', { class: 'muted sm' }, '家人的慢性病留意項目只會讓某些菜往後排、不會排除。下面這幾個開關才會把菜整個拿掉——由你決定，預設全關。'),
    ...AVOID.map((a) => switchRow({
      label: a.label, hint: a.hint, checked: avoidNow()[a.key] === true, key: `avoid-${a.key}`,
      onChange: async (on) => { await prefs.set('avoid', { ...avoidNow(), [a.key]: on }); refresh(); },
    })),
    h('p', { class: 'muted xs' }, '改了之後下次「產生」或「重新產生」才會生效。'),
  );

  // ---- 顯示 ----
  const displayCard = h('section', { class: 'card', dataset: { card: 'display' } },
    h('h2', { class: 'card-title' }, '顯示'),
    h('p', { class: 'muted sm' }, '字級。看不清楚就往右調，按鈕與可以點的地方會跟著變大。'),
    chips({
      options: prefs.FONT_SCALES.map((s) => ({ value: s, label: prefs.FONT_SCALE_LABELS[s] })),
      value: prefs.get('fontScale'), name: 'fontScale',
      onChange: async (v) => { await prefs.set('fontScale', v); prefs.applyFontScale(); refresh(); },
    }),
  );

  // ---- 備份 ----
  const exportBtn = h('button', { class: 'btn', type: 'button', dataset: { action: 'export' } }, '匯出備份檔');
  exportBtn.addEventListener('click', async () => {
    const bundle = await exportBundle();
    const blob = new Blob([JSON.stringify(bundle, null, 1)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: bundleFilename() });
    document.body.append(a);
    a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 2000);
    toast('已產生備份檔');
  });
  const fileInput = h('input', { type: 'file', accept: '.json,application/json', class: 'file-input', 'aria-label': '選擇備份檔' });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    let bundle;
    try { bundle = JSON.parse(await file.text()); }
    catch { await modal({ title: '讀不了這個檔', body: h('p', {}, '這不是 JSON 檔。你現在的資料沒有被動到。') }); fileInput.value = ''; return; }
    const errors = validateImport(bundle);
    if (errors.length) {
      await modal({
        title: '備份檔有問題，沒有匯入',
        body: h('div', {}, h('p', {}, h('strong', {}, '你現在的資料沒有被動到。')), h('ul', { class: 'err-list' }, ...errors.slice(0, 8).map((e) => h('li', {}, e))), errors.length > 8 ? h('p', { class: 'muted sm' }, `…另 ${errors.length - 8} 項`) : null),
      });
      fileInput.value = '';
      return;
    }
    const counts = bundleCounts(bundle);
    const summary = Object.entries(counts).filter(([, n]) => n > 0).map(([k, n]) => `${STORE_LABELS[k] ?? k} ${n}`).join('、') || '（空的備份）';
    const yes = await confirmDialog(`匯入會取代這台裝置上目前所有資料。\n備份內容：${summary}\n備份時間：${bundle.exportedAt ?? '未知'}`, { danger: true, okLabel: '匯入並取代' });
    fileInput.value = '';
    if (!yes) return;
    try {
      await applyImport(bundle);
      await store.reloadUserData();
      prefs.load().then(() => prefs.applyFontScale());
      toast('已匯入');
      refresh();
    } catch (e) {
      await modal({ title: '匯入失敗', body: h('p', {}, String(e.message || e)) });
    }
  });
  const importLabel = h('label', { class: 'btn btn-danger file-btn' }, '匯入並取代…', fileInput);
  const backupCard = h('section', { class: 'card', dataset: { card: 'backup' } },
    h('h2', { class: 'card-title' }, '備份'),
    h('p', { class: 'muted sm' }, '所有資料只存在這台裝置。換手機、或 iPhone 主畫面 App 與 Safari 不共用資料時，匯出的檔案是唯一的救援路徑。'),
    h('div', { class: 'btn-row' }, exportBtn, importLabel),
  );

  // ---- 關於 ----
  const about = h('section', { class: 'card', dataset: { card: 'about' } },
    h('h2', { class: 'card-title' }, '關於與資料來源'),
    h('p', { dataset: { field: 'appVersion' } }, `MealMate 家庭三餐規劃 · 版本 ${APP_VERSION}`),
    h('p', { class: 'muted sm' }, `內建食譜 ${meta ? meta.count : '—'} 道、我的食譜 ${store.userRecipes().length} 道；食材營養資料版本 ${store.foodsVersion() ?? '尚未取得'}。`),
    eduNode('fda.tfnd.attribution'),
    eduNode('hpa.open-data.attribution'),
    h('div', { class: 'notice' },
      h('strong', {}, '這個 App 不是什麼'),
      h('p', {}, '不是醫療器材、不是營養處方。慢性病的留意設定只影響顯示與排序；長輩實際怎麼吃，請以醫師或營養師的指示為準。'),
      h('p', {}, '所有資料只存在這台裝置；沒有帳號、沒有上傳、沒有任何外部連線。'),
    ),
    h('p', { class: 'muted xs' }, '純前端 PWA，原始碼公開於 GitHub（yolin0513/mealmate）。'),
  );

  render(membersCard, daysCard, rulesCard, displayCard, backupCard, noticeCard(), about);
}

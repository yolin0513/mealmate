// 買菜：依採買區間分卡、賣場分區、勾「買了」「家裡有」、常備品另列、複製成文字、印出。

import { h, pill, chips, toast, modal } from '../ui.js';
import { setTop, render } from '../shell.js';
import * as store from '../store.js';
import * as prefs from '../prefs.js';
import { mondayOf, weekKeyOf, addDays, isoDate, parseDate, DAY_LABELS } from '../planner.js';
import { buildShoppingList, quantityText, listAsText, extraText, suggestedText, manualUnitOf, SECTIONS, rangesOfPlan } from '../shopping.js';
import { refresh } from '../router.js';

function fmtMD(iso) { const d = parseDate(iso); return `${d.getMonth() + 1}/${d.getDate()}`; }
function dayLabel(iso) { return DAY_LABELS[(parseDate(iso).getDay() + 6) % 7]; }

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('已複製，可以貼到 LINE 或備忘錄');
  } catch {
    await modal({ title: '複製清單', body: h('div', {}, h('p', { class: 'muted sm' }, '這個瀏覽器不讓網頁直接複製；長按下面的文字全選複製。'), h('textarea', { class: 'field', rows: 12, readOnly: true, dataset: { field: 'copyFallback' } }, text)) });
  }
}

export default async function shoppingView(query = {}) {
  setTop({ title: '買菜', back: false });
  const offset = query.w === 'next' ? 1 : 0;
  const mondayIso = addDays(mondayOf(isoDate(new Date())), 7 * offset);
  const weekKey = weekKeyOf(mondayIso);
  const plan = await store.getPlan(weekKey);
  const shoppingDays = prefs.get('shoppingDays') ?? [];
  const weekChips = chips({
    options: [{ value: 'this', label: '本週' }, { value: 'next', label: '下週' }], value: offset ? 'next' : 'this', name: 'week',
    onChange: (v) => { location.hash = v === 'next' ? '#/shopping?w=next' : '#/shopping'; },
  });

  if (!plan) {
    render(h('section', { class: 'card', dataset: { card: 'shoppingEmpty' } },
      h('div', { class: 'row-actions' }, weekChips),
      h('h2', { class: 'card-title' }, offset ? '下週還沒有菜單' : '這週還沒有菜單'),
      h('p', { class: 'muted' }, '先到「本週」產生菜單，這裡會依你的買菜日分成幾張清單：同一種食材跨餐加總、換成「約幾顆、幾把」、依賣場分區排好；油鹽醬油這類常備品另外列。'),
      h('a', { class: 'btn btn-primary', href: offset ? '#/?w=next' : '#/' }, '去產生菜單'),
    ));
    return;
  }

  const members = store.members();
  const idx = store.foodsIndex();
  const recipesById = new Map(store.allRecipes().map((r) => [r.id, r]));
  // 份數是每張採買卡各自調的（客人通常只來週末，不該把整週都加倍），
  // 所以要先讀出每張卡存著的人數，再算數量。
  const extraByRange = {};
  const manualByRange = {};
  for (const r of rangesOfPlan(plan, shoppingDays)) {
    const saved = await store.getShopping(r.key);
    extraByRange[r.key] = { meat: saved.extra?.meat ?? 0, veg: saved.extra?.veg ?? 0 };
    manualByRange[r.key] = saved.manual ?? {};
  }
  const { ranges } = buildShoppingList({ plan, recipesById, members, idx, units: store.units(), shoppingDays, extraByRange, manualByRange });
  if (!ranges.length) {
    render(h('section', { class: 'card', dataset: { card: 'shoppingEmpty' } }, h('div', { class: 'row-actions' }, weekChips), h('h2', { class: 'card-title' }, '這週沒有自己煮的餐'), h('p', { class: 'muted' }, '菜單裡每一餐都是外食或不煮，所以沒有東西要買。')));
    return;
  }

  const head = h('section', { class: 'card', dataset: { card: 'shoppingHead' } },
    h('div', { class: 'row-actions' }, weekChips, h('span', { class: 'muted sm' }, `${fmtMD(plan.monday)}（一）– ${fmtMD(addDays(plan.monday, 6))}（日）`)),
    h('p', { class: 'muted sm' }, shoppingDays.length
      ? `買菜日：星期${[...shoppingDays].sort().map((d) => '日一二三四五六'[d]).join('、')}；每張清單涵蓋到下一個買菜日前一天。`
      : '還沒設定買菜日，整週一張清單。到「家人」分頁勾星期幾買菜，清單會分開、規劃時也會考慮食材放幾天。'),
    h('p', { class: 'muted xs' }, `數量依${members.length ? `家裡 ${members.length} 位實際吃的人數` : '食譜原份量（還沒新增家人）'}縮放，是估計值；依實際包裝與食量調整。`),
  );

  const cards = [];
  for (const range of ranges) {
    const row = await store.getShopping(range.key);
    row.weekKey = weekKey;
    const save = () => store.saveShopping(row);
    const progress = h('p', { class: 'muted sm', dataset: { field: 'progress' } });
    const drawProgress = () => {
      const total = range.items.length;
      const bought = range.items.filter((it) => row.checked?.[it.foodId]).length;
      const have = range.items.filter((it) => !row.checked?.[it.foodId] && row.have?.[it.foodId]).length;
      progress.textContent = `已買 ${bought}／${total}${have ? `，家裡有 ${have}` : ''}`;
    };
    const sections = SECTIONS.map((sec) => {
      const items = range.items.filter((it) => it.section === sec);
      if (!items.length) return null;
      return h('div', { class: 'shop-section', dataset: { section: sec } },
        h('h3', { class: 'shop-section-title' }, sec, ' ', pill(String(items.length))),
        ...items.map((it) => {
          const cb = h('input', { type: 'checkbox', checked: !!row.checked?.[it.foodId], 'aria-label': `買了 ${it.labels[0] ?? it.name}` });
          const haveBtn = h('button', { class: 'chip chip-sm' + (row.have?.[it.foodId] ? ' on' : ''), type: 'button', 'aria-pressed': row.have?.[it.foodId] ? 'true' : 'false', dataset: { action: 'have', food: it.foodId } }, '家裡有');
          // 數量本身就是按鈕：站在菜攤前看到「建議 2 條」但想買 3 條，點一下就改。
          // 改過的用「已改」標出來，並且講得出原本建議多少 —— 不然她下次看不懂這個數字哪來的。
          const unit = manualUnitOf(it);
          const qtyBtn = h('button', {
            class: 'shop-qty num qty-btn' + (it.manual ? ' manual' : ''), type: 'button',
            'aria-label': `${it.labels[0] ?? it.name} 要買多少，現在是 ${quantityText(it)}，點一下可以改`,
            dataset: { action: 'editQty', food: it.foodId },
          }, quantityText(it));
          qtyBtn.addEventListener('click', async () => {
            const cur = manualUnitOf(it);
            const box = h('input', { type: 'number', class: 'field field-num', min: '0', step: String(cur.step),
              value: String(cur.value), inputMode: 'decimal', 'aria-label': '數量', dataset: { field: 'qtyInput' } });
            const res = await modal({
              title: `${it.labels[0] ?? it.name} 要買多少`,
              body: h('div', { class: 'qty-edit' },
                h('p', { class: 'muted sm' }, `原本建議 ${suggestedText(it)}。你可以自己改，改過的會標「已改」。`),
                h('label', { class: 'extra-field' }, box, h('span', { class: 'muted sm' }, cur.unit))),
              actions: [{ value: null, label: '取消' }, { value: 'reset', label: '改回建議值' }, { value: 'ok', label: '存起來', primary: true }],
            });
            if (res == null) return;
            row.manual = { ...(row.manual ?? {}) };
            if (res === 'reset') delete row.manual[it.foodId];
            else {
              const q = Number(box?.value);
              if (!Number.isFinite(q) || q <= 0) { toast('請填大於 0 的數字'); return; }
              row.manual[it.foodId] = q;
            }
            await save();
            refresh();
          });
          const line = h('div', { class: 'shop-row' + (row.checked?.[it.foodId] ? ' done' : '') + (row.have?.[it.foodId] ? ' have' : '') + (it.manual ? ' manual' : ''), dataset: { buy: it.foodId, manual: it.manual ? 'true' : 'false' } },
            h('label', { class: 'check shop-check' }, cb,
              h('span', { class: 'shop-main' },
                // 第一行只留「名稱＋數量」：別名（薑絲／老薑／薑片）擠在名稱後面會把數量推到下一行，
                // 而站在菜攤前要一眼看到買幾顆。別名移到下面那行（layouttest 量出來的）。
                h('span', { class: 'shop-line1' },
                  h('span', { class: 'shop-name' }, it.labels[0] ?? it.name),
                  qtyBtn),
                h('span', { class: 'muted xs shop-uses' },
                  it.manual ? h('span', { class: 'qty-manual' }, '已改') : null,
                  it.manual ? '；' : '',
                  it.labels.length > 1 ? `也叫${it.labels.slice(1, 3).join('、')}；` : '',
                  `用在：${it.uses.slice(0, 2).map((u) => `${fmtMD(u.date)} ${u.recipe}`).join('、')}${it.uses.length > 2 ? ` 等 ${it.uses.length} 餐` : ''}`))),
            haveBtn,
          );
          cb.addEventListener('change', async () => { row.checked = { ...(row.checked ?? {}), [it.foodId]: cb.checked }; line.classList.toggle('done', cb.checked); await save(); drawProgress(); });
          haveBtn.addEventListener('click', async () => {
            const on = !row.have?.[it.foodId];
            row.have = { ...(row.have ?? {}), [it.foodId]: on };
            haveBtn.classList.toggle('on', on); haveBtn.setAttribute('aria-pressed', on ? 'true' : 'false'); line.classList.toggle('have', on);
            await save(); drawProgress();
          });
          return line;
        }));
    });
    drawProgress();
    const copyBtn = h('button', { class: 'btn', type: 'button', dataset: { action: 'copyList' } }, '複製清單');
    copyBtn.addEventListener('click', () => copyText(listAsText(range, { checked: row.checked ?? {}, have: row.have ?? {} })));
    const printBtn = h('button', { class: 'btn', type: 'button', dataset: { action: 'print' } }, '印出');
    printBtn.addEventListener('click', () => window.print());
    // 「多幾個人吃」：預設 0 ＝ 照家人實際人數。分葷素是因為分軌要各自正確 ——
    // 家裡 1 素 2 葷、來了 2 位吃葷的，正確是葷鍋軌 ×2、素鍋軌 ×1，
    // 單一倍率會同時多買素菜又買不夠肉。
    const numField = (kind, label) => {
      const input = h('input', {
        type: 'number', class: 'field field-num', min: '0', max: '20', step: '1',
        value: String(range.extra[kind] ?? 0), inputMode: 'numeric',
        'aria-label': `多幾位${label}`, dataset: { field: `extra${kind === 'meat' ? 'Meat' : 'Veg'}` },
      });
      input.addEventListener('change', async () => {
        const n = Math.max(0, Math.min(20, Math.floor(Number(input.value) || 0)));
        input.value = String(n);
        row.extra = { ...(row.extra ?? { meat: 0, veg: 0 }), [kind]: n };
        await save();
        refresh();     // 數量要重算，整頁重畫最單純
      });
      return h('label', { class: 'extra-field' }, h('span', { class: 'muted sm' }, label), input);
    };
    const extraNote = extraText(range.extra);
    const extraBlock = h('div', { class: 'extra-row no-print', dataset: { field: 'extraRow' } },
      h('span', { class: 'muted sm' }, '這張清單多幾個人吃'),
      numField('meat', '吃葷'), numField('veg', '吃素'),
      h('span', { class: 'muted xs' }, '0 ＝ 照家裡人數'));

    cards.push(h('section', { class: 'card shop-card', dataset: { card: 'shopRange', range: range.key } },
      h('h2', { class: 'card-title' }, range.label,
        // 調過就一定要看得出來，不然她對不起來為什麼買這麼多
        extraNote ? ' ' : '', extraNote ? pill(extraNote, 'accent') : null),
      h('p', { class: 'muted sm' }, `給 ${range.dates.map((d) => `${fmtMD(d)}（${dayLabel(d)}）`).join('、')} 的餐`),
      extraBlock,
      extraNote ? h('p', { class: 'muted sm', dataset: { field: 'extraNote' } },
        `下面的數量已經${extraNote}算進去了（家裡 ${members.length} 位 ＋ 這些人）。`) : null,
      progress,
      ...sections,
      range.pantry.length ? h('details', { class: 'how', dataset: { field: 'pantry' } }, h('summary', {}, `常備品 ${range.pantry.length} 項（用完再補）`),
        h('p', { class: 'muted sm' }, range.pantry.map((p) => p.labels[0] ?? p.name).join('、'))) : null,
      h('div', { class: 'btn-row no-print' }, copyBtn, printBtn),
    ));
  }
  render(head, ...cards);
}

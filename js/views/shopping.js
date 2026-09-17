// 買菜：依採買區間分卡、賣場分區、勾「買了」、常備品另列、複製成文字、印出。

import { h, pill, chips, toast, modal } from '../ui.js';
import { setTop, render } from '../shell.js';
import * as store from '../store.js';
import * as prefs from '../prefs.js';
import { mondayOf, weekKeyOf, addDays, isoDate, parseDate, DAY_LABELS } from '../planner.js';
import { buildShoppingList, quantityText, listAsText, suggestedText, manualUnitOf, customKey, sanitizeCustom, SECTIONS, rangesOfPlan, orderRangesForToday, rangeIsPast } from '../shopping.js';
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
      h('p', { class: 'muted' }, '先到「本週」產生菜單。'),
      h('a', { class: 'btn btn-primary', href: offset ? '#/?w=next' : '#/' }, '去產生菜單'),
    ));
    return;
  }

  const members = store.members();
  const idx = store.foodsIndex();
  const recipesById = new Map(store.allRecipes().map((r) => [r.id, r]));
  const manualByRange = {};
  const customByRange = {};
  for (const r of rangesOfPlan(plan, shoppingDays)) {
    const saved = await store.getShopping(r.key);
    manualByRange[r.key] = saved.manual ?? {};
    customByRange[r.key] = saved.custom ?? [];
  }
  const { ranges } = buildShoppingList({ plan, recipesById, members, idx, units: store.units(), shoppingDays, manualByRange, customByRange });
  if (!ranges.length) {
    render(h('section', { class: 'card', dataset: { card: 'shoppingEmpty' } }, h('div', { class: 'row-actions' }, weekChips), h('h2', { class: 'card-title' }, '這週沒有自己煮的餐'), h('p', { class: 'muted' }, '菜單裡每一餐都是外食或不煮，所以沒有東西要買。')));
    return;
  }

  const head = h('section', { class: 'card', dataset: { card: 'shoppingHead' } },
    h('div', { class: 'row-actions' }, weekChips, h('span', { class: 'muted sm' }, `${fmtMD(plan.monday)}（一）– ${fmtMD(addDays(plan.monday, 6))}（日）`)),
    h('p', { class: 'muted sm' }, shoppingDays.length
      ? `買菜日：星期${[...shoppingDays].sort().map((d) => '日一二三四五六'[d]).join('、')}；每張清單涵蓋到下一個買菜日前一天。`
      : '還沒設定買菜日，整週一張清單。到「家人」分頁勾星期幾買菜，清單會分開、規劃時也會考慮食材放幾天。'),
    h('p', { class: 'muted xs' }, `數量依${members.length ? `家裡 ${members.length} 位的食量` : '食譜原份量'}縮放、最少一份，是估計值。`),
  );

  // 還沒到的買菜日排前面；已經過去的排後面、預設收合（仍然打得開，因為常常要補買）。
  const todayIso = isoDate(new Date());
  const cards = [];
  for (const range of orderRangesForToday(ranges, todayIso)) {
    const past = rangeIsPast(range, todayIso);
    const row = await store.getShopping(range.key);
    row.weekKey = weekKey;
    const save = () => store.saveShopping(row);
    // ---- 摺疊：讓她一眼看出還缺什麼 ----
    // 規則（使用者要求，照這個做）：
    //   · 手動操作過的區塊 → 照手動（row.fold[key] = 'open' | 'closed'）。
    //     手動展開一個已經買齊的區塊，不會再被自動收回去 —— 手動意圖優先。
    //   · 沒操作過 → 裡面每一項都勾了「買了」就收合，還有沒買的就展開。
    // 收合用 hidden 真的移出版面（螢幕閱讀器也讀不到），標題留一行摘要，
    // 讓她知道那一區是「買齊了」不是「不見了」。
    const cardIdx = cards.length;
    const isDone = (k) => !!row.checked?.[k];
    const folds = [];
    const applyFolds = () => {
      for (const f of folds) {
        const total = f.itemKeys.length;
        const doneN = f.itemKeys.filter(isDone).length;
        const allDone = total > 0 && doneN === total;
        const manual = row.fold?.[f.key];
        const open = manual ? manual === 'open' : (f.defaultOpen ?? !allDone);
        f.body.hidden = !open;
        f.toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        f.caret.textContent = open ? '▾' : '▸';
        f.summary.textContent = f.note ?? (allDone ? `（${total} 項全買齊）` : `（還差 ${total - doneN} 項）`);
        const box = f.body.parentElement;
        if (box) { box.dataset.foldOpen = open ? 'true' : 'false'; box.dataset.foldDone = allDone ? 'true' : 'false'; }
      }
    };
    // defaultOpen：沒操作過時固定展開或收合（不看買齊）；note：固定的摘要文字（取代「還差 N 項」）
    const makeFold = ({ key, label, extraNodes = [], itemKeys, bodyNodes, headingTag, headingClass, defaultOpen, note }) => {
      const id = `fold-${cardIdx}-${folds.length}`;
      const caret = h('span', { class: 'fold-caret', 'aria-hidden': 'true' }, '▾');
      const summary = h('span', { class: 'muted xs fold-summary', dataset: { field: 'foldSummary' } });
      const toggle = h('button', { class: 'fold-toggle', type: 'button', 'aria-expanded': 'true', 'aria-controls': id, dataset: { action: 'fold', fold: key } },
        caret, h('span', { class: 'fold-label' }, label), ...extraNodes, summary);
      const body = h('div', { class: 'fold-body', id }, ...bodyNodes);
      const f = { key, itemKeys, toggle, body, caret, summary, defaultOpen, note, heading: h(headingTag, { class: headingClass }, toggle) };
      folds.push(f);
      toggle.addEventListener('click', async () => {
        const nowOpen = toggle.getAttribute('aria-expanded') === 'true';
        row.fold = { ...(row.fold ?? {}), [key]: nowOpen ? 'closed' : 'open' };
        await save();
        applyFolds();
      });
      return f;
    };
    const progress = h('p', { class: 'muted sm', dataset: { field: 'progress' } });
    const drawProgress = () => {
      const total = range.items.length + range.custom.length;
      const bought = range.items.filter((it) => row.checked?.[it.foodId]).length
        + range.custom.filter((c) => row.checked?.[customKey(c.id)]).length;
      progress.textContent = `已買 ${bought}／${total}`;
    };
    const sections = SECTIONS.map((sec) => {
      const items = range.items.filter((it) => it.section === sec);
      if (!items.length) return null;
      const f = makeFold({ key: sec, label: sec, extraNodes: [' ', pill(String(items.length))], itemKeys: items.map((it) => it.foodId), headingTag: 'h3', headingClass: 'shop-section-title', bodyNodes: items.map((it) => {
          const cb = h('input', { type: 'checkbox', checked: !!row.checked?.[it.foodId], 'aria-label': `買了 ${it.labels[0] ?? it.name}` });
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
                h('p', { class: 'muted sm' }, `原本建議 ${suggestedText(it)}。`),
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
          const line = h('div', { class: 'shop-row' + (row.checked?.[it.foodId] ? ' done' : '') + (it.manual ? ' manual' : ''), dataset: { buy: it.foodId, manual: it.manual ? 'true' : 'false' } },
            h('label', { class: 'check shop-check', 'aria-label': `買了 ${it.labels[0] ?? it.name}` }, cb,
              h('span', { class: 'shop-main' },
                // 第一行只留「名稱＋數量」：別名（薑絲／老薑／薑片）擠在名稱後面會把數量推到下一行，
                // 而站在菜攤前要一眼看到買幾顆。別名移到下面那行（layouttest 量出來的）。
                h('span', { class: 'shop-line1' },
                  h('span', { class: 'shop-name' }, it.labels[0] ?? it.name),
                  qtyBtn),
                // 第二行：這道食材的別名、有沒有改過數量、用在哪幾餐。
                h('span', { class: 'muted xs shop-uses' },
                  h('span', { class: 'shop-uses-text' },
                  it.manual ? h('span', { class: 'qty-manual' }, '已改') : null,
                  it.manual ? '；' : '',
                  it.labels.length > 1 ? `也叫${it.labels.slice(1, 3).join('、')}；` : '',
                  `用在：${it.uses.slice(0, 2).map((u) => `${fmtMD(u.date)} ${u.recipe}`).join('、')}${it.uses.length > 2 ? ` 等 ${it.uses.length} 餐` : ''}`)))),
          );
          cb.addEventListener('change', async () => { row.checked = { ...(row.checked ?? {}), [it.foodId]: cb.checked }; line.classList.toggle('done', cb.checked); await save(); drawProgress(); applyFolds(); });
          return line;
        }) });
      return h('div', { class: 'shop-section', dataset: { section: sec } }, f.heading, f.body);
    });
    drawProgress();
    const copyBtn = h('button', { class: 'btn', type: 'button', dataset: { action: 'copyList' } }, '複製清單');
    copyBtn.addEventListener('click', () => copyText(listAsText(range, { checked: row.checked ?? {} })));
    const printBtn = h('button', { class: 'btn', type: 'button', dataset: { action: 'print' } }, '印出');
    printBtn.addEventListener('click', () => window.print());
    // ---- 自己加的項目（例如飯後水果）----
    // 不在菜單裡、不解析食藥署編號、不進營養：純粹是「這趟也要買」。所以另起一區，
    // 每一項都標「自己加的」，免得她以為加了會影響菜單或營養。
    const customKeys = range.custom.map((c) => customKey(c.id));
    const customRows = range.custom.map((c) => {
      const k = customKey(c.id);
      const cb = h('input', { type: 'checkbox', checked: !!row.checked?.[k], 'aria-label': `買了 ${c.name}` });
      const del = h('button', { class: 'btn btn-sm btn-quiet-danger', type: 'button', dataset: { action: 'deleteCustom', custom: c.id } }, '刪除');
      const line = h('div', { class: 'shop-row custom-row' + (row.checked?.[k] ? ' done' : ''), dataset: { custom: c.id } },
        h('label', { class: 'check shop-check', 'aria-label': `買了 ${c.name}` }, cb,
          h('span', { class: 'shop-main' },
            h('span', { class: 'shop-line1' },
              h('span', { class: 'shop-name' }, c.name),
              c.qty ? h('span', { class: 'shop-qty num' }, c.qty) : null),
            h('span', { class: 'muted xs shop-uses' }, pill('自己加的'), '　', del))));
      cb.addEventListener('change', async () => { row.checked = { ...(row.checked ?? {}), [k]: cb.checked }; line.classList.toggle('done', cb.checked); await save(); drawProgress(); applyFolds(); });
      del.addEventListener('click', async () => {
        const res = await modal({ title: `刪除「${c.name}」？`, body: null,
          actions: [{ value: null, label: '取消' }, { value: 'del', label: '刪除', danger: true }] });
        if (res !== 'del') return;
        row.custom = (row.custom ?? []).filter((x) => x.id !== c.id);
        const nextChecked = { ...(row.checked ?? {}) };
        delete nextChecked[k];
        row.checked = nextChecked;
        await save();
        refresh();
      });
      return line;
    });
    const customFold = range.custom.length
      ? makeFold({ key: '自己加的', label: '自己加的', extraNodes: [' ', pill(String(range.custom.length))], itemKeys: customKeys, headingTag: 'h3', headingClass: 'shop-section-title',
        bodyNodes: customRows })
      : null;
    const addBtn = h('button', { class: 'btn', type: 'button', dataset: { action: 'addCustom' } }, '＋ 自己加一項');
    addBtn.addEventListener('click', async () => {
      const nameIn = h('input', { type: 'text', class: 'field', maxLength: 30, placeholder: '例：蘋果、衛生紙', 'aria-label': '要買什麼', dataset: { field: 'customName' } });
      const qtyIn = h('input', { type: 'text', class: 'field', maxLength: 12, placeholder: '例：3 顆、一串（可不填）', 'aria-label': '買多少', dataset: { field: 'customQty' } });
      const res = await modal({
        title: '自己加一項',
        body: h('div', { class: 'qty-edit' },
          h('label', { class: 'custom-field' }, h('span', { class: 'muted sm' }, '要買什麼'), nameIn),
          h('label', { class: 'custom-field' }, h('span', { class: 'muted sm' }, '買多少'), qtyIn)),
        actions: [{ value: null, label: '取消' }, { value: 'ok', label: '加進清單', primary: true }],
      });
      if (res !== 'ok') return;
      const id = `c-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
      const item = sanitizeCustom([{ id, name: nameIn.value, qty: qtyIn.value }])[0];
      if (!item) { toast('請填要買什麼'); return; }
      row.custom = [...(row.custom ?? []), item];
      await save();
      refresh();
    });

    // 常備品：原本是一行 <details> 標題，跟其他分類的摺疊長得不一樣（使用者回報）。改成同一套摺疊。
    // 它沒有勾選（用完再補、不用每次買），所以不套「買齊就收」：預設收合，摘要講「用完再補」而不是「還差 N 項」。
    const pantryFold = range.pantry.length
      ? makeFold({ key: '常備品', label: '常備品', extraNodes: [' ', pill(String(range.pantry.length))], itemKeys: [], defaultOpen: false, note: '（用完再補）', headingTag: 'h3', headingClass: 'shop-section-title',
        bodyNodes: [h('p', { class: 'muted sm pantry-list' }, range.pantry.map((p) => p.labels[0] ?? p.name).join('、'))] })
      : null;
    const pantryEl = pantryFold ? h('div', { class: 'shop-section pantry-section', dataset: { section: '常備品', field: 'pantry' } }, pantryFold.heading, pantryFold.body) : null;
    const customSectionEl = customFold ? h('div', { class: 'shop-section custom-section', dataset: { section: '自己加的' } }, customFold.heading, customFold.body) : null;
    // 整張卡也可以摺疊：全部買齊（含自己加的）就收起來，只留標題「（N 項全買齊）」
    // 三顆按鈕跟著日期的摺疊一起收（使用者要求：主畫面只留日期與進度）。
    const actionsRow = h('div', { class: 'shop-actions no-print', dataset: { field: 'shopActions' } }, addBtn, copyBtn, printBtn);
    const cardFold = makeFold({
      key: '__card', label: range.label,
      extraNodes: past ? [' ', pill('已過')] : [],
      itemKeys: [...range.items.map((it) => it.foodId), ...customKeys],
      headingTag: 'h2', headingClass: 'card-title',
      // 過去的買菜日預設收合（不看買齊沒買齊）；沒過的照舊 —— 還有沒買的就展開。
      // 手動展開過的仍然照手動（row.fold['__card']），所以補買的時候不會被自動收回去。
      defaultOpen: past ? false : undefined,
      bodyNodes: [...sections.filter(Boolean), customSectionEl, pantryEl, actionsRow],
    });
    applyFolds();

    cards.push(h('section', { class: 'card shop-card', dataset: { card: 'shopRange', range: range.key, past: past ? 'true' : 'false' } },
      cardFold.heading,
      h('p', { class: 'muted sm' }, `給 ${range.dates.map((d) => `${fmtMD(d)}（${dayLabel(d)}）`).join('、')} 的餐`),
      progress,
      cardFold.body,
    ));
  }
  render(head, ...cards);
}

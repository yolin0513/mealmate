// 買菜：依採買區間分卡、賣場分區、勾「買了」「家裡有」、常備品另列、複製成文字、印出。

import { h, pill, chips, toast, modal } from '../ui.js';
import { setTop, render } from '../shell.js';
import * as store from '../store.js';
import * as prefs from '../prefs.js';
import { mondayOf, weekKeyOf, addDays, isoDate, parseDate, DAY_LABELS } from '../planner.js';
import { buildShoppingList, quantityText, listAsText, SECTIONS } from '../shopping.js';

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
  const { ranges } = buildShoppingList({ plan, recipesById, members, idx, units: store.units(), shoppingDays });
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
          const line = h('div', { class: 'shop-row' + (row.checked?.[it.foodId] ? ' done' : '') + (row.have?.[it.foodId] ? ' have' : ''), dataset: { buy: it.foodId } },
            h('label', { class: 'check shop-check' }, cb,
              h('span', { class: 'shop-main' },
                // 第一行只留「名稱＋數量」：別名（薑絲／老薑／薑片）擠在名稱後面會把數量推到下一行，
                // 而站在菜攤前要一眼看到買幾顆。別名移到下面那行（layouttest 量出來的）。
                h('span', { class: 'shop-line1' },
                  h('span', { class: 'shop-name' }, it.labels[0] ?? it.name),
                  h('span', { class: 'shop-qty num' }, quantityText(it))),
                h('span', { class: 'muted xs shop-uses' },
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
    cards.push(h('section', { class: 'card shop-card', dataset: { card: 'shopRange', range: range.key } },
      h('h2', { class: 'card-title' }, range.label),
      h('p', { class: 'muted sm' }, `給 ${range.dates.map((d) => `${fmtMD(d)}（${dayLabel(d)}）`).join('、')} 的餐`),
      progress,
      ...sections,
      range.pantry.length ? h('details', { class: 'how', dataset: { field: 'pantry' } }, h('summary', {}, `常備品 ${range.pantry.length} 項（用完再補）`),
        h('p', { class: 'muted sm' }, range.pantry.map((p) => p.labels[0] ?? p.name).join('、'))) : null,
      h('div', { class: 'btn-row no-print' }, copyBtn, printBtn),
    ));
  }
  render(head, ...cards);
}

// 買菜頁（npm run shoppingviewtest，puppeteer）：區間卡、數量與 Node 端手算一致、勾買了／家裡有並保存、複製、印出、常備品。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ok, eq, section, done, everyOf, noneOf } from './tap.mjs';
import { openApp, acceptWelcome, goto, titleIs, textOf, sleep, clickEl } from './browserlib.mjs';
import { indexFoods } from '../js/foods.js';
import { buildShoppingList, rangesOfPlan, quantityText } from '../js/shopping.js';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const foods = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/foods.json'), 'utf8'));
const aliases = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/aliases.json'), 'utf8'));
const units = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/units.json'), 'utf8'));
const recipes = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/recipes.json'), 'utf8')).recipes;
const idx = indexFoods(foods, aliases);
const byId = new Map(recipes.map((r) => [r.id, r]));

const { page, pageErrors, close } = await openApp();
try {
  await acceptWelcome(page);
  const members = await page.evaluate(async () => {
    const store = await import('./js/store.js');
    const prefs = await import('./js/prefs.js');
    const { newMember } = await import('./js/members.js');
    await store.saveMember({ ...newMember(), name: '爸', diet: 'omni' });
    await store.saveMember({ ...newMember(), name: '阿嬤', diet: 'lactoOvo' });
    await prefs.set('shoppingDays', [1, 4]);
    return store.members();
  });

  section('還沒有菜單');
  await goto(page, '#/shopping');
  await titleIs(page, '買菜');
  await page.waitForSelector('[data-card="shoppingEmpty"]');
  ok((await textOf(page, '[data-card="shoppingEmpty"]')).includes('還沒有菜單'), '空狀態講清楚');

  section('產生菜單後有清單');
  await goto(page, '#/');
  await titleIs(page, '本週菜單');
  await page.waitForSelector('[data-action="generate"]');
  await clickEl(page, '[data-action="generate"]');
  await page.waitForSelector('[data-card="weekHead"]');
  const plan = await page.evaluate(async () => {
    const store = await import('./js/store.js');
    const { mondayOf, weekKeyOf, isoDate } = await import('./js/planner.js');
    return store.getPlan(weekKeyOf(mondayOf(isoDate(new Date()))));
  });
  ok(plan && plan.slots.length === 21, '（前提）計畫存在');
  const expected = buildShoppingList({ plan, recipesById: byId, members, idx, units, shoppingDays: [1, 4] });
  const expectedRanges = rangesOfPlan(plan, [1, 4]);
  await goto(page, '#/shopping');
  await titleIs(page, '買菜');
  await page.waitForSelector('[data-card="shopRange"]');
  const rangeKeys = await page.$$eval('[data-card="shopRange"]', (els) => els.map((e) => e.dataset.range));
  eq(rangeKeys, expectedRanges.map((r) => r.key), `區間跟 Node 端算的一樣：${rangeKeys.join('、')}`);
  ok(rangeKeys.length >= 2, `（母體）${rangeKeys.length} 個區間`);

  section('每一項的數量跟 Node 端手算一致');
  for (const r of expected.ranges) {
    const dom = await page.$$eval(`[data-card="shopRange"][data-range="${r.key}"] .shop-row`, (els) => els.map((e) => ({ food: e.dataset.buy, qty: e.querySelector('.shop-qty').textContent.trim(), name: e.querySelector('.shop-name').textContent.trim() })));
    const exp = r.items.map((it) => ({ food: it.foodId, qty: quantityText(it) }));
    ok(dom.length >= 5, `（母體）${r.label} 有 ${dom.length} 項`);
    eq(dom.map((d) => [d.food, d.qty]), exp.map((e) => [e.food, e.qty]), `${r.label}：每一項的食材與數量文字跟 buildShoppingList 算的逐項相同`);
    everyOf(dom, (d) => /^約 /.test(d.qty) && !/ 0 g|NaN|undefined/.test(d.qty), '每一項都是「約 …」、沒有 0 g');
    everyOf(dom, (d) => d.name.length > 0, '每一項有名稱');
  }
  const sections = await page.$$eval('[data-card="shopRange"] .shop-section', (els) => els.map((e) => e.dataset.section));
  ok(sections.includes('蔬菜'), '有蔬菜區');
  const pantryText = await page.$eval('[data-card="shopRange"] [data-field="pantry"]', (el) => el.textContent);
  ok(/鹽|沙拉油|醬油/.test(pantryText), `常備品另列：${pantryText.slice(0, 60)}`);
  const pageText = await textOf(page, '#view');
  ok(!/\b(null|undefined|NaN)\b/.test(pageText), '沒有漏出 null／undefined／NaN');
  noneOf(['建議攝取', '應該吃'], (w) => pageText.includes(w), '沒有處方式的字');

  section('勾「買了」「家裡有」並保存');
  const firstKey = rangeKeys[0];
  const firstFood = await page.$eval(`[data-card="shopRange"][data-range="${firstKey}"] .shop-row`, (el) => el.dataset.buy);
  await clickEl(page, `[data-card="shopRange"][data-range="${firstKey}"] .shop-row[data-buy="${firstFood}"] input[type="checkbox"]`);
  await sleep(200);
  const progress1 = await textOf(page, `[data-card="shopRange"][data-range="${firstKey}"] [data-field="progress"]`);
  ok(/^已買 1／\d+/.test(progress1), `進度：${progress1}`);
  const secondFood = await page.$$eval(`[data-card="shopRange"][data-range="${firstKey}"] .shop-row`, (els) => els[1]?.dataset.buy);
  await clickEl(page, `[data-card="shopRange"][data-range="${firstKey}"] [data-action="have"][data-food="${secondFood}"]`);
  await sleep(200);
  eq(await page.$eval(`[data-card="shopRange"][data-range="${firstKey}"] [data-action="have"][data-food="${secondFood}"]`, (el) => el.getAttribute('aria-pressed')), 'true', '家裡有 → 按下');
  await page.reload({ waitUntil: 'networkidle0' });
  await titleIs(page, '買菜');
  await page.waitForSelector('[data-card="shopRange"]');
  eq(await page.$eval(`[data-card="shopRange"][data-range="${firstKey}"] .shop-row[data-buy="${firstFood}"] input`, (el) => el.checked), true, '重新載入後「買了」還在');
  eq(await page.$eval(`[data-card="shopRange"][data-range="${firstKey}"] [data-action="have"][data-food="${secondFood}"]`, (el) => el.getAttribute('aria-pressed')), 'true', '重新載入後「家裡有」還在');
  const haveSet = await page.evaluate(async () => { const store = await import('./js/store.js'); const { mondayOf, weekKeyOf, isoDate } = await import('./js/planner.js'); return [...await store.haveFoodsForWeek(weekKeyOf(mondayOf(isoDate(new Date()))))]; });
  eq(haveSet, [secondFood], '「家裡有」進到下次產生要用的集合');

  section('複製與印出');
  await page.evaluate(() => {
    window.__copied = null; window.__printed = false;
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: (t) => { window.__copied = t; return Promise.resolve(); } }, configurable: true });
    window.print = () => { window.__printed = true; };
  });
  await clickEl(page, `[data-card="shopRange"][data-range="${firstKey}"] [data-action="copyList"]`);
  await sleep(200);
  const copied = await page.evaluate(() => window.__copied);
  ok(typeof copied === 'string' && copied.startsWith('【') && copied.includes('— ') && copied.includes('估計值'), `複製的文字有標題、分區、估計值提醒：${String(copied).split('\n')[0]}`);
  ok(copied.includes('✓'), '勾了「買了」的那一項在文字裡是 ✓');
  await clickEl(page, `[data-card="shopRange"][data-range="${firstKey}"] [data-action="print"]`);
  eq(await page.evaluate(() => window.__printed), true, '印出鈕呼叫 window.print');


  section('這張清單多幾個人吃：預設 0、調過看得出痕跡、數量跟著變');
  {
    await goto(page, '#/shopping');
    await page.waitForSelector('[data-card="shopRange"]');

    const cardKey = await page.$eval('[data-card="shopRange"]', (el) => el.dataset.range);
    const sel = `[data-card="shopRange"][data-range="${cardKey}"]`;
    const readCard = () => page.evaluate((s) => {
      const card = document.querySelector(s);
      const rows = [...card.querySelectorAll('.shop-row')].map((r) => ({
        food: r.dataset.buy,
        qty: r.querySelector('.shop-qty')?.textContent?.trim() ?? '',
      }));
      const meat = card.querySelector('[data-field="extraMeat"]');
      const veg = card.querySelector('[data-field="extraVeg"]');
      return {
        meatVal: meat?.value, vegVal: veg?.value,
        meatH: meat ? Math.round(meat.getBoundingClientRect().height) : null,
        note: card.querySelector('[data-field="extraNote"]')?.textContent?.trim() ?? '',
        pill: card.querySelector('.card-title .pill')?.textContent?.trim() ?? '',
        rows,
        pantry: card.querySelector('[data-field="pantry"]')?.textContent?.trim() ?? '',
      };
    }, sel);

    const beforeFold = await page.evaluate((s2) => {
      const d = document.querySelector(`${s2} [data-field="extraRow"]`);
      return { open: d?.open, summary: d?.querySelector('summary')?.textContent?.trim() };
    }, sel);
    eq(beforeFold.open, false, '「這次有客人？」預設是收起來的（逐項手改才是主角）');
    eq(beforeFold.summary, '這次有客人？', `收起來時的字：「${beforeFold.summary}」`);
    await page.evaluate((s2) => { document.querySelector(`${s2} [data-field="extraRow"]`).open = true; }, sel);
    await sleep(150);

    const before = await readCard();
    eq(before.meatVal, '0', '「吃葷」預設是 0');
    eq(before.vegVal, '0', '「吃素」預設是 0');
    eq(before.note, '', '沒調過就沒有那行說明');
    eq(before.pill, '', '沒調過標題旁也沒有標記');
    ok(before.meatH >= 44, `數字框按得到（${before.meatH}px ≥ 44）`);
    ok(before.rows.length >= 5, `（母體）這張卡有 ${before.rows.length} 項`);

    // 加 2 位吃葷
    await page.evaluate((s) => {
      const el = document.querySelector(`${s} [data-field="extraMeat"]`);
      el.value = '2';
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, sel);
    await sleep(700);
    await page.waitForSelector(`${sel} [data-field="extraNote"]`, { timeout: 10000 });
    const after = await readCard();
    eq(after.meatVal, '2', '調過之後欄位記著 2');
    ok(/多加 2 位吃葷/.test(after.pill), `標題旁看得出來：「${after.pill}」`);
    ok(/多加 2 位吃葷/.test(after.note) && /家裡/.test(after.note), `而且有一行說明數量已經算進去了：「${after.note}」`);
    const afterFold = await page.evaluate((s2) => {
      const d = document.querySelector(`${s2} [data-field="extraRow"]`);
      return { open: d?.open, summary: d?.querySelector('summary')?.textContent?.trim() };
    }, sel);
    eq(afterFold.open, true, '填了人數之後預設是展開的（收起來就看不到痕跡了）');
    ok(/2 位吃葷/.test(afterFold.summary), `連收合的那一行都講得出加了幾個人：「${afterFold.summary}」`);

    // 數量真的變多（至少一項），而且沒有任何一項變少
    const byFood = new Map(before.rows.map((r) => [r.food, r.qty]));
    const changed = after.rows.filter((r) => byFood.has(r.food) && byFood.get(r.food) !== r.qty);
    ok(changed.length >= 1, `${changed.length} 項的數量跟著變了（例：${changed[0]?.food} ${byFood.get(changed[0]?.food)} → ${changed[0]?.qty}）`);
    const gramsOf = (t) => Number(/(\d+) g/.exec(t)?.[1] ?? 0);
    everyOf(after.rows.filter((r) => byFood.has(r.food)), (r) => gramsOf(r.qty) >= gramsOf(byFood.get(r.food)),
      '加人之後沒有任何一項變少');

    // 常備品那一段沒有數字
    ok(after.pantry.length > 0, `（前提）常備品那一段有內容：「${after.pantry.slice(0, 24)}…」`);
    noneOf([after.pantry.replace(/常備品 \d+ 項/, '')], (t) => /\d+ g|約 \d/.test(t), '常備品只列名稱，沒有數量（所以不會被乘）');

    // 重新載入之後還記得
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector(`${sel} [data-field="extraMeat"]`);
    await sleep(300);
    const reloaded = await readCard();
    eq(reloaded.meatVal, '2', '重新載入後仍然記得加了 2 位');
    ok(/多加 2 位吃葷/.test(reloaded.pill), '痕跡也還在');

    // 複製出去的文字帶得到
    const copied = await page.evaluate(async (s) => {
      const store = await import('./js/store.js');
      const prefs = await import('./js/prefs.js');
      const { buildShoppingList, listAsText, rangesOfPlan } = await import('./js/shopping.js');
      const { weekKeyOf, mondayOf, isoDate } = await import('./js/planner.js');
      const plan = await store.getPlan(weekKeyOf(mondayOf(isoDate(new Date()))));
      const days = prefs.get('shoppingDays') ?? [];
      const extraByRange = {};
      for (const r of rangesOfPlan(plan, days)) {
        const row = await store.getShopping(r.key);
        extraByRange[r.key] = { meat: row.extra?.meat ?? 0, veg: row.extra?.veg ?? 0 };
      }
      const { ranges } = buildShoppingList({ plan, recipesById: new Map(store.allRecipes().map((x) => [x.id, x])), members: store.members(), idx: store.foodsIndex(), units: store.units(), shoppingDays: days, extraByRange });
      const target = ranges.find((r) => r.key === s);
      return listAsText(target, {});
    }, cardKey);
    ok(/多加 2 位吃葷/.test(copied), '複製出去的文字也講明加了 2 位吃葷');

    // 調回 0 → 痕跡消失、數量回原本
    await page.evaluate((s) => {
      const el = document.querySelector(`${s} [data-field="extraMeat"]`);
      el.value = '0';
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, sel);
    await sleep(700);
    const reset = await readCard();
    eq(reset.pill, '', '調回 0 → 標題旁的標記消失');
    eq(reset.note, '', '說明那一行也消失');
    const backToSame = after.rows.filter((r) => byFood.has(r.food)).every((r) => {
      const now = reset.rows.find((x) => x.food === r.food);
      return now && now.qty === byFood.get(r.food);
    });
    ok(backToSame, '每一項的數量都回到原本（0 ＝ 照家裡人數，不是「回不去了」）');
  }


  section('逐項手改數量：點數字就能改、看得出「已改」、改得回去');
  {
    await goto(page, '#/family');
    await titleIs(page, '家人');
    await goto(page, '#/shopping');
    await page.waitForSelector('[data-card="shopRange"] .shop-row');

    const first = await page.evaluate(() => {
      const r = document.querySelector('[data-card="shopRange"] .shop-row');
      const btn = r.querySelector('[data-action="editQty"]');
      return { food: r.dataset.buy, qty: btn.textContent.trim(), manual: r.dataset.manual, h: Math.round(btn.getBoundingClientRect().height) };
    });
    eq(first.manual, 'false', '一開始沒有任何一項是手改的');
    ok(!first.qty.includes('已改'), `數量旁邊沒有「已改」：${first.qty}`);
    eq(await page.$$eval('.qty-manual', (e) => e.length), 0, '整頁一個「已改」都沒有');
    ok(first.h >= 44, `數量本身就是按鈕，按得到（${first.h}px ≥ 44）`);
    const sel = `.shop-row[data-buy="${first.food}"]`;

    // 點開來改
    await clickEl(page, `${sel} [data-action="editQty"]`);
    await page.waitForSelector('.modal-card [data-field="qtyInput"]');
    const dialog = await page.evaluate(() => ({
      title: document.querySelector('.modal-title')?.textContent?.trim(),
      hint: document.querySelector('.modal-card .muted')?.textContent?.trim(),
      value: document.querySelector('[data-field="qtyInput"]')?.value,
      buttons: [...document.querySelectorAll('.modal-actions .btn')].map((b) => b.textContent.trim()),
    }));
    ok(/要買多少/.test(dialog.title), `對話框標題講的是這一項：「${dialog.title}」`);
    ok(/原本建議/.test(dialog.hint), `而且講得出原本建議多少：「${dialog.hint}」`);
    ok(dialog.buttons.includes('改回建議值'), `有「改回建議值」可以按（${dialog.buttons.join('／')}）`);

    await page.evaluate(() => {
      const box = document.querySelector('[data-field="qtyInput"]');
      box.value = String(Number(box.value) + 2);
    });
    const typed = await page.$eval('[data-field="qtyInput"]', (e) => e.value);
    await page.evaluate(() => [...document.querySelectorAll('.modal-actions .btn')].find((b) => b.textContent.trim() === '存起來').click());
    await sleep(900);
    await page.waitForSelector(`${sel}[data-manual="true"]`, { timeout: 10000 });

    const after = await page.evaluate((s) => {
      const r = document.querySelector(s);
      const btn = r.querySelector('[data-action="editQty"]');
      return { manual: r.dataset.manual, qty: btn.textContent.trim(), aria: btn.getAttribute('aria-label'), mark: r.querySelector('.qty-manual')?.textContent?.trim() ?? '' };
    }, sel);
    eq(after.manual, 'true', '這一項標成手改過');
    eq(after.mark, '已改', '第二行出現「已改」（原本建議多少留在點開的對話框裡，不然特大字級下會蓋到「家裡有」）');
    ok(!after.qty.includes('已改'), `第一行只留名稱＋數量（站在菜攤前要一眼看到買幾顆）：${after.qty}`);
    ok(after.qty.includes(typed.replace(/\.0$/, '')), `顯示的就是我打的數字 ${typed}：${after.qty}`);
    ok(/點一下可以改/.test(after.aria), '讀螢幕的人也知道這個數字可以改');

    // 別項沒被波及
    const otherManual = await page.$$eval('.shop-row[data-manual="true"]', (els) => els.length);
    eq(otherManual, 1, '只有這一項被標成手改，其他都沒有');

    // 重新載入後還在
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector(`${sel}`);
    await sleep(400);
    const reloaded = await page.$eval(sel, (r) => ({ manual: r.dataset.manual, qty: r.querySelector('[data-action="editQty"]').textContent.trim(), mark: r.querySelector('.qty-manual')?.textContent?.trim() ?? '' }));
    eq(reloaded.manual, 'true', '重新載入後還記得改過');
    eq(reloaded.qty, after.qty, '數量也一樣');
    ok(/已改/.test(reloaded.mark), '「已改」的標記也還在');

    // 複製出去的文字帶「已改」
    const copied = await page.evaluate(async () => {
      const store = await import('./js/store.js');
      const prefs = await import('./js/prefs.js');
      const { buildShoppingList, listAsText, rangesOfPlan } = await import('./js/shopping.js');
      const { weekKeyOf, mondayOf, isoDate } = await import('./js/planner.js');
      const plan = await store.getPlan(weekKeyOf(mondayOf(isoDate(new Date()))));
      const days = prefs.get('shoppingDays') ?? [];
      const extraByRange = {}; const manualByRange = {};
      for (const r of rangesOfPlan(plan, days)) {
        const row = await store.getShopping(r.key);
        extraByRange[r.key] = { meat: row.extra?.meat ?? 0, veg: row.extra?.veg ?? 0 };
        manualByRange[r.key] = row.manual ?? {};
      }
      const { ranges } = buildShoppingList({ plan, recipesById: new Map(store.allRecipes().map((x) => [x.id, x])), members: store.members(), idx: store.foodsIndex(), units: store.units(), shoppingDays: days, extraByRange, manualByRange });
      return ranges.map((r) => listAsText(r, {})).join('\n');
    });
    ok(/（已改）/.test(copied), '複製出去的文字帶著「（已改）」');

    // 改回建議值
    await clickEl(page, `${sel} [data-action="editQty"]`);
    await page.waitForSelector('.modal-card [data-field="qtyInput"]');
    await page.evaluate(() => [...document.querySelectorAll('.modal-actions .btn')].find((b) => b.textContent.trim() === '改回建議值').click());
    await sleep(900);
    const reset = await page.$eval(sel, (r) => ({ manual: r.dataset.manual, qty: r.querySelector('[data-action="editQty"]').textContent.trim() }));
    eq(reset.manual, 'false', '改回建議值 → 不再標成手改');
    eq(reset.qty, first.qty, '數量也回到原本的建議值');
  }


  section('「這次有客人？」：說明在上、葷素兩格對齊在下');
  {
    const vp0 = page.viewport();
    await goto(page, '#/family');
    await titleIs(page, '家人');
    await goto(page, '#/shopping');
    await page.waitForSelector('[data-card="shopRange"] [data-field="extraRow"]');
    const measureGuest = () => page.evaluate(() => {
      const d = document.querySelector('[data-card="shopRange"] [data-field="extraRow"]');
      d.open = true;
      const desc = d.querySelector('[data-field="extraDesc"]').getBoundingClientRect();
      const m = d.querySelector('[data-field="extraMeat"]').getBoundingClientRect();
      const v = d.querySelector('[data-field="extraVeg"]').getBoundingClientRect();
      const card = d.closest('[data-card="shopRange"]').getBoundingClientRect();
      return { descBottom: desc.bottom, mTop: m.top, vTop: v.top, mLeft: m.left, mRight: m.right, vLeft: v.left, vRight: v.right, mW: m.width, vW: v.width, mH: m.height, cardLeft: card.left, cardRight: card.right };
    });
    for (const [w, scale] of [[390, 'md'], [320, 'xl']]) {
      await page.setViewport({ width: w, height: 900 });
      await page.evaluate(async (s) => { const prefs = await import('./js/prefs.js'); await prefs.set('fontScale', s); prefs.applyFontScale(s); }, scale);
      await sleep(300);
      const g = await measureGuest();
      ok(g.mTop >= g.descBottom - 1 && g.vTop >= g.descBottom - 1, `${w}px／${scale}：說明文字在上，兩個框都在它下面`);
      ok(Math.abs(g.mTop - g.vTop) <= 2, `${w}px／${scale}：葷、素兩個框在同一列（上緣差 ${Math.round(Math.abs(g.mTop - g.vTop))}px）`);
      ok(g.vLeft >= g.mRight - 1, `${w}px／${scale}：兩格並排（素在葷的右邊，不是疊到下面）`);
      ok(Math.abs(g.mW - g.vW) <= 2, `${w}px／${scale}：兩格一樣寬（${Math.round(g.mW)}／${Math.round(g.vW)}px），看起來是對齊的`);
      ok(g.mLeft >= g.cardLeft - 1 && g.vRight <= g.cardRight + 1, `${w}px／${scale}：兩格都在卡片裡，沒有撐破`);
      ok(g.mH >= 44, `${w}px／${scale}：框高 ${Math.round(g.mH)}px（≥ 44）`);
    }
    await page.setViewport(vp0);
    await page.evaluate(async () => { const prefs = await import('./js/prefs.js'); await prefs.set('fontScale', 'md'); prefs.applyFontScale('md'); });
  }

  section('自己加的項目：飯後水果這種不在菜單裡的東西');
  {
    await goto(page, '#/family');
    await titleIs(page, '家人');
    await goto(page, '#/shopping');
    await page.waitForSelector('[data-card="shopRange"] [data-action="addCustom"]');
    const cardKey = await page.$eval('[data-card="shopRange"]', (el) => el.dataset.range);
    const card = `[data-card="shopRange"][data-range="${cardKey}"]`;
    const totalOf = async () => Number(/／(\d+)/.exec(await textOf(page, `${card} [data-field="progress"]`))?.[1] ?? NaN);
    const before = await totalOf();
    ok(Number.isFinite(before) && before >= 5, `（前提）進度讀得到總數 ${before}`);
    eq(await page.$$eval(`${card} .custom-row`, (e) => e.length), 0, '一開始沒有自己加的項目');

    const addOne = async (name, qty) => {
      await clickEl(page, `${card} [data-action="addCustom"]`);
      await page.waitForSelector('.modal-card [data-field="customName"]');
      await page.type('.modal-card [data-field="customName"]', name);
      if (qty) await page.type('.modal-card [data-field="customQty"]', qty);
      await page.evaluate(() => [...document.querySelectorAll('.modal-actions .btn')].find((b) => b.textContent.trim() === '加進清單').click());
      await sleep(900);
    };
    const rowInfo = (name) => page.evaluate((c, n) => {
      const r = [...document.querySelectorAll(`${c} .custom-row`)].find((x) => x.querySelector('.shop-name')?.textContent === n);
      return r ? {
        id: r.dataset.custom, qty: r.querySelector('.shop-qty')?.textContent ?? null,
        pill: r.querySelector('.pill')?.textContent ?? '', checked: r.querySelector('input[type="checkbox"]').checked,
        inFoodSection: !!r.closest('.shop-section:not(.custom-section)'), inNoPrint: !!r.closest('.no-print'),
      } : null;
    }, card, name);

    await addOne('蘋果', '3 顆');
    await page.waitForSelector(`${card} .custom-row`);
    const apple = await rowInfo('蘋果');
    ok(apple, '加進去的項目出現在清單裡');
    eq(apple.qty, '3 顆', '數量就是打的那個');
    eq(apple.pill, '自己加的', '標「自己加的」，跟系統算出來的食材分得出來');
    eq(apple.inFoodSection, false, '放在自己的區塊，沒有混進蔬菜、肉類那些分區');
    eq(apple.inNoPrint, false, '會被印出來（不在 no-print 裡）');
    eq(await totalOf(), before + 1, '進度的總數加 1（「還缺什麼」要把它算進去）');

    await addOne('香蕉', '');
    const banana = await rowInfo('香蕉');
    ok(banana, '不填數量也加得進去');
    eq(banana.qty, null, '沒填數量就不顯示數量欄（不會出現空白或 undefined）');

    const countBeforeBlank = await page.$$eval(`${card} .custom-row`, (e) => e.length);
    await addOne('   ', '5 個');
    eq(await page.$$eval(`${card} .custom-row`, (e) => e.length), countBeforeBlank, '名稱是空白 → 不加進清單');

    await page.evaluate((c, id) => document.querySelector(`${c} .custom-row[data-custom="${id}"] input[type="checkbox"]`).click(), card, apple.id);
    await sleep(400);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector(`${card} .custom-row`);
    await sleep(300);
    const appleAfter = await rowInfo('蘋果');
    ok(appleAfter, '重新整理後自己加的項目還在');
    eq(appleAfter.checked, true, '勾過的「買了」也還在');

    const text = await page.evaluate(async (key) => {
      const store = await import('./js/store.js');
      const prefs = await import('./js/prefs.js');
      const { buildShoppingList, listAsText, rangesOfPlan } = await import('./js/shopping.js');
      const { weekKeyOf, mondayOf, isoDate } = await import('./js/planner.js');
      const plan = await store.getPlan(weekKeyOf(mondayOf(isoDate(new Date()))));
      const days = prefs.get('shoppingDays') ?? [];
      const extraByRange = {}; const manualByRange = {}; const customByRange = {}; let mine = null;
      for (const r of rangesOfPlan(plan, days)) {
        const row = await store.getShopping(r.key);
        extraByRange[r.key] = { meat: row.extra?.meat ?? 0, veg: row.extra?.veg ?? 0 };
        manualByRange[r.key] = row.manual ?? {};
        customByRange[r.key] = row.custom ?? [];
        if (r.key === key) mine = row;
      }
      const { ranges } = buildShoppingList({ plan, recipesById: new Map(store.allRecipes().map((x) => [x.id, x])), members: store.members(), idx: store.foodsIndex(), units: store.units(), shoppingDays: days, extraByRange, manualByRange, customByRange });
      return listAsText(ranges.find((r) => r.key === key), { checked: mine.checked ?? {}, have: mine.have ?? {} });
    }, cardKey);
    ok(/✓ 蘋果　3 顆（自己加的）/.test(text), '複製出去的文字帶名稱、數量、勾選狀態，並標「自己加的」');
    ok(/□ 香蕉（自己加的）/.test(text), '沒填數量的那項也在');

    const others = await page.$$eval('[data-card="shopRange"]', (els, k) => els.filter((e) => e.dataset.range !== k).map((e) => e.querySelectorAll('.custom-row').length), cardKey);
    ok(others.length >= 1, `（前提）還有 ${others.length} 張別的採買卡`);
    everyOf(others, (n) => n === 0, '別的卡沒有出現（自己加的跟著加的那張卡走）');

    await page.evaluate((c, id) => document.querySelector(`${c} .custom-row[data-custom="${id}"] [data-action="deleteCustom"]`).click(), card, banana.id);
    await page.waitForSelector('.modal-card .modal-title');
    const delTitle = await textOf(page, '.modal-card .modal-title');
    ok(delTitle.includes('香蕉'), `刪除前先問一次：「${delTitle}」`);
    await page.evaluate(() => [...document.querySelectorAll('.modal-actions .btn')].find((b) => b.textContent.trim() === '刪除').click());
    await sleep(900);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector(`${card} .custom-row`);
    await sleep(300);
    eq(await rowInfo('香蕉'), null, '刪掉之後重新整理也不在了');
    ok(await rowInfo('蘋果'), '另一項沒被一起刪掉');

    // 清掉，不影響後面的測試
    await page.evaluate(async (key) => { const store = await import('./js/store.js'); const row = await store.getShopping(key); row.custom = []; row.checked = {}; await store.saveShopping(row); }, cardKey);
  }

  section('購物清單摺疊：買齊的區塊自動收合，手動展開的不會被收回去');
  {
    const cardKey = await page.$eval('[data-card="shopRange"]', (el) => el.dataset.range);
    const card = `[data-card="shopRange"][data-range="${cardKey}"]`;
    await page.evaluate(async (key) => { const store = await import('./js/store.js'); const row = await store.getShopping(key); row.checked = {}; row.have = {}; row.fold = {}; row.custom = []; await store.saveShopping(row); }, cardKey);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector(`${card} .shop-section`);
    await sleep(300);
    const reloadCard = async () => { await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForSelector(`${card} .shop-section`); await sleep(300); };
    const secState = (sec) => page.evaluate((c, s) => {
      const box = document.querySelector(`${c} .shop-section[data-section="${s}"]`);
      const t = box.querySelector('[data-action="fold"]');
      const body = box.querySelector('.fold-body');
      return {
        open: t.getAttribute('aria-expanded'), hidden: body.hidden, h: Math.round(body.getBoundingClientRect().height),
        summary: box.querySelector('[data-field="foldSummary"]').textContent, done: box.dataset.foldDone,
        toggleH: Math.round(t.getBoundingClientRect().height), controls: t.getAttribute('aria-controls') === body.id,
        rows: [...box.querySelectorAll('.shop-row')].map((r) => r.dataset.buy),
      };
    }, card, sec);
    const click = (sel) => page.evaluate((s) => document.querySelector(s).click(), sel);

    const sections = await page.$$eval(`${card} .shop-section:not(.custom-section)`, (els) => els.map((e) => ({ sec: e.dataset.section, n: e.querySelectorAll('.shop-row').length })));
    ok(sections.length >= 2, `（母體）這張卡有 ${sections.length} 個分區`);
    const initial = [];
    for (const s of sections) initial.push(await secState(s.sec));
    everyOf(initial, (s) => s.open === 'true' && s.hidden === false, '什麼都還沒買 → 每一區都展開');
    everyOf(initial, (s) => s.toggleH >= 44, '每一區的標題按得到（≥ 44px）');
    everyOf(initial, (s) => s.controls, 'aria-controls 指到它控制的那一塊');

    const target = [...sections].filter((s) => s.n >= 2).sort((a, b) => a.n - b.n)[0];
    ok(target, `（前提）挑一區至少兩項的：「${target?.sec}」${target?.n} 項 —— 一半勾「買了」、一半勾「家裡有」，兩種都要算數`);
    const other = sections.find((s) => s.sec !== target.sec);
    const tRows = initial[sections.indexOf(target)].rows;
    for (const [i, id] of tRows.entries()) {
      if (i % 2 === 0) await click(`${card} .shop-row[data-buy="${id}"] input[type="checkbox"]`);
      else await click(`${card} .shop-row[data-buy="${id}"] [data-action="have"]`);
      await sleep(250);
    }
    await sleep(300);
    const done1 = await secState(target.sec);
    eq(done1.open, 'false', `「${target.sec}」每一項都勾了買了或家裡有 → 自動收合`);
    eq(done1.hidden, true, '內容用 hidden 真的移出版面');
    eq(done1.h, 0, '收起來不佔高度');
    ok(done1.summary.includes(`${tRows.length} 項全買齊`), `標題留摘要，讓她知道是買齊了不是不見了：「${done1.summary}」`);
    eq(done1.done, 'true', '整區標成買齊');
    const otherState = await secState(other.sec);
    eq(otherState.open, 'true', `（對照）還沒買的「${other.sec}」仍然展開`);
    ok(/還差 \d+ 項/.test(otherState.summary), `還沒買完的區塊講還差幾項：「${otherState.summary}」`);

    await click(`${card} .shop-section[data-section="${target.sec}"] [data-action="fold"]`);
    await sleep(300);
    eq((await secState(target.sec)).open, 'true', '手動展開買齊的那一區 → 打開');
    await click(`${card} .shop-row[data-buy="${tRows[0]}"] input[type="checkbox"]`);
    await sleep(250);
    await click(`${card} .shop-row[data-buy="${tRows[0]}"] input[type="checkbox"]`);
    await sleep(300);
    eq((await secState(target.sec)).open, 'true', '取消一項再勾回來（又買齊了）→ 還是展開：手動意圖優先，不會被自動收回去');
    await reloadCard();
    const reloaded = await secState(target.sec);
    eq(reloaded.open, 'true', '重新整理後，手動展開的狀態還在');
    eq(reloaded.done, 'true', '（對照）它確實是買齊的 —— 開著是因為手動，不是因為沒買齊');

    await click(`${card} .shop-section[data-section="${other.sec}"] [data-action="fold"]`);
    await sleep(300);
    const oc = await secState(other.sec);
    eq(oc.open, 'false', '手動收合還沒買完的區塊 → 收起來');
    ok(/還差 \d+ 項/.test(oc.summary), `收起來的標題仍然講還差幾項：「${oc.summary}」`);
    await reloadCard();
    eq((await secState(other.sec)).open, 'false', '重新整理後，手動收合也還在');

    // 整張卡：每一項都買了 → 整張收合，但「自己加一項」仍然按得到
    await page.evaluate(async (key) => {
      const store = await import('./js/store.js');
      const prefs = await import('./js/prefs.js');
      const { buildShoppingList } = await import('./js/shopping.js');
      const { weekKeyOf, mondayOf, isoDate } = await import('./js/planner.js');
      const plan = await store.getPlan(weekKeyOf(mondayOf(isoDate(new Date()))));
      const { ranges } = buildShoppingList({ plan, recipesById: new Map(store.allRecipes().map((x) => [x.id, x])), members: store.members(), idx: store.foodsIndex(), units: store.units(), shoppingDays: prefs.get('shoppingDays') ?? [] });
      const r = ranges.find((x) => x.key === key);
      const row = await store.getShopping(key);
      row.checked = Object.fromEntries(r.items.map((it) => [it.foodId, true]));
      row.have = {}; row.fold = {}; row.custom = [];
      await store.saveShopping(row);
    }, cardKey);
    await reloadCard();
    const cs = await page.evaluate((c) => {
      const el = document.querySelector(c);
      const t = el.querySelector('.card-title [data-action="fold"]');
      const body = document.getElementById(t.getAttribute('aria-controls'));
      return { open: t.getAttribute('aria-expanded'), hidden: body.hidden, summary: el.querySelector('.card-title [data-field="foldSummary"]').textContent,
        addH: Math.round(el.querySelector('[data-action="addCustom"]').getBoundingClientRect().height) };
    }, card);
    eq(cs.open, 'false', '整張卡每一項都買了 → 整張收合');
    eq(cs.hidden, true, '整張卡的清單內容也是用 hidden 移出版面');
    ok(/全買齊/.test(cs.summary), `卡片標題講全買齊：「${cs.summary}」`);
    ok(cs.addH >= 44, '收合之後「自己加一項」仍然按得到（隨時可以補買）');

    await page.evaluate(async (key) => { const store = await import('./js/store.js'); const row = await store.getShopping(key); row.checked = {}; row.have = {}; row.fold = {}; await store.saveShopping(row); }, cardKey);
  }

  eq(pageErrors, [], '沒有未攔截的例外');
} finally {
  await close();
}
done('shoppingviewtest');

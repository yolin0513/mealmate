// 買菜頁（npm run shoppingviewtest，puppeteer）：區間卡、數量與 Node 端手算一致、勾「買了」並保存、複製、印出、常備品。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ok, eq, section, done, everyOf, noneOf } from './tap.mjs';
import { pinToday, TEST_MONDAY, openApp, acceptWelcome, goto, titleIs, textOf, sleep, clickEl } from './browserlib.mjs';
import { indexFoods } from '../js/foods.js';
import { buildShoppingList, rangesOfPlan, orderRangesForToday, quantityText } from '../js/shopping.js';
import { mondayOf, isoDate, addDays } from '../js/planner.js';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const foods = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/foods.json'), 'utf8'));
const aliases = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/aliases.json'), 'utf8'));
const units = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/units.json'), 'utf8'));
const recipes = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/recipes.json'), 'utf8')).recipes;
const idx = indexFoods(foods, aliases);
const byId = new Map(recipes.map((r) => [r.id, r]));

const { page, browser, port, pageErrors, close } = await openApp();
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
  // 2026-09-18 起畫面只算今天（含）以後的餐（fromDate），Node 端要算一樣的東西才比得出來
  const todayIso0 = TEST_MONDAY; // 頁面的「今天」固定在本週一（browserlib.openApp），Node 端用同一天
  const expected = buildShoppingList({ plan, recipesById: byId, members, idx, units, shoppingDays: [1, 4], fromDate: todayIso0 });
  const expectedRanges = rangesOfPlan(plan, [1, 4]);
  await goto(page, '#/shopping');
  await titleIs(page, '買菜');
  await page.waitForSelector('[data-card="shopRange"]');
  const rangeKeys = await page.$$eval('[data-card="shopRange"]', (els) => els.map((e) => e.dataset.range));
  // 2026-09-17：順序改成「還有餐要煮的排前面，整個過去的排後面」（見 shopping.orderRangesForToday）。
  // 這條原本比的是 rangesOfPlan 的時間順序，現在比的是畫面真正該有的順序 —— 語意換掉，不是刪掉。
  const todayIso = TEST_MONDAY;
  eq(rangeKeys, orderRangesForToday(expectedRanges, todayIso).map((r) => r.key), `區間與順序跟 Node 端算的一樣：${rangeKeys.join('、')}`);
  eq([...rangeKeys].sort(), expectedRanges.map((r) => r.key).sort(), '而且一張清單都沒有少（只是換順序）');
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

  section('勾「買了」並保存');
  const firstKey = rangeKeys[0];
  const firstFood = await page.$eval(`[data-card="shopRange"][data-range="${firstKey}"] .shop-row`, (el) => el.dataset.buy);
  await clickEl(page, `[data-card="shopRange"][data-range="${firstKey}"] .shop-row[data-buy="${firstFood}"] input[type="checkbox"]`);
  await sleep(200);
  const progress1 = await textOf(page, `[data-card="shopRange"][data-range="${firstKey}"] [data-field="progress"]`);
  ok(/^已買 1／\d+/.test(progress1), `進度：${progress1}`);
  await page.reload({ waitUntil: 'networkidle0' });
  await titleIs(page, '買菜');
  await page.waitForSelector('[data-card="shopRange"]');
  eq(await page.$eval(`[data-card="shopRange"][data-range="${firstKey}"] .shop-row[data-buy="${firstFood}"] input`, (el) => el.checked), true, '重新載入後「買了」還在');

  section('「家裡有」已經移除（2026-09-17）：畫面上沒有那顆按鈕，進度列也只講買了幾項');
  {
    // Yolin 決定移除：它不扣採買量、也沒有跨餐追蹤，冰箱裡的剩菜用「自己指定菜」排進去更直接。
    const rows = await page.$$eval('#view .shop-row', (els) => els.length);
    ok(rows >= 10, `（母體）畫面上有 ${rows} 列食材 —— 有東西可以長出那顆按鈕`);
    eq(await page.$$eval('#view [data-action="have"]', (els) => els.length), 0, '整頁一顆「家裡有」都沒有');
    const prog = await textOf(page, `[data-card="shopRange"][data-range="${firstKey}"] [data-field="progress"]`);
    ok(/^已買 \d+／\d+$/.test(prog), `進度列只剩「已買 N／M」，沒有「家裡有 N」那一欄：「${prog}」`);
    const uses = await page.$$eval('#view .shop-uses', (els) => els.map((e) => e.textContent.trim()));
    ok(uses.length >= 10, `（母體）第二行掃了 ${uses.length} 列`);
    noneOf(uses, (t) => t.includes('家裡有'), '每一列的第二行也沒有「家裡有」這幾個字');
  }

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
    eq(after.mark, '已改', '第二行出現「已改」（原本建議多少留在點開的對話框裡，特大字級下才不會蓋到說明文字）');
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
      const manualByRange = {};
      for (const r of rangesOfPlan(plan, days)) {
        const row = await store.getShopping(r.key);
        manualByRange[r.key] = row.manual ?? {};
      }
      const { ranges } = buildShoppingList({ plan, recipesById: new Map(store.allRecipes().map((x) => [x.id, x])), members: store.members(), idx: store.foodsIndex(), units: store.units(), shoppingDays: days, manualByRange, fromDate: isoDate(new Date()) });
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
      // modal() 30ms 後才把焦點放到名稱欄；機器忙時那個計時器會在打「買多少」途中把焦點搶回來，
      // 數量就打進名稱欄了（突變基準緊接在 layouttest 後面跑時抓到：「名稱是空白」那條偶發失敗）。等焦點落定再打字。
      await page.waitForFunction(() => document.activeElement?.dataset?.field === 'customName', { timeout: 10000 });
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
      const manualByRange = {}; const customByRange = {}; let mine = null;
      for (const r of rangesOfPlan(plan, days)) {
        const row = await store.getShopping(r.key);
        manualByRange[r.key] = row.manual ?? {};
        customByRange[r.key] = row.custom ?? [];
        if (r.key === key) mine = row;
      }
      const { ranges } = buildShoppingList({ plan, recipesById: new Map(store.allRecipes().map((x) => [x.id, x])), members: store.members(), idx: store.foodsIndex(), units: store.units(), shoppingDays: days, manualByRange, customByRange, fromDate: isoDate(new Date()) });
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

  section('主畫面只留日期與進度：三顆按鈕跟著日期的摺疊一起收；沒有「這次有客人？」');
  {
    // 使用者 2026-09-16 要求：買菜頁主畫面更簡潔 —— 三顆按鈕收進日期的摺疊裡、客人功能整個拿掉。
    const cardSel = '[data-card="shopRange"]';
    await page.waitForSelector(`${cardSel} [data-field="shopActions"]`);
    const state = () => page.evaluate((c) => {
      const card = document.querySelector(c);
      const actions = card.querySelector('[data-field="shopActions"]');
      const body = card.querySelector('[data-action="fold"][data-fold="__card"]').closest('.card').querySelector('.fold-body');
      return {
        inFold: body.contains(actions), visible: actions.getBoundingClientRect().height > 0,
        buttons: [...actions.querySelectorAll('button')].map((b) => b.textContent.trim()),
        guests: document.querySelectorAll('[data-field="extraRow"], [data-field="extraMeat"], [data-field="extraVeg"]').length,
        guestText: document.body.innerText.includes('這次有客人'),
      };
    }, cardSel);
    const open = await state();
    eq(open.buttons, ['＋ 自己加一項', '複製清單', '印出'], '三顆按鈕都在');
    ok(open.inFold, '三顆按鈕在日期摺疊的內容裡（不是卡片底部）');
    ok(open.visible, '（對照）日期展開時看得到');
    eq(open.guests, 0, '畫面上沒有客人數的欄位了');
    eq(open.guestText, false, '也沒有「這次有客人」這句話');
    await clickEl(page, `${cardSel} [data-action="fold"][data-fold="__card"]`);
    await sleep(300);
    ok(!(await state()).visible, '把日期收起來 → 三顆按鈕也跟著收起來');
    await clickEl(page, `${cardSel} [data-action="fold"][data-fold="__card"]`);
    await sleep(300);
    ok((await state()).visible, '再展開就回來');
  }

  section('購物清單摺疊：買齊的區塊自動收合，手動展開的不會被收回去');
  {
    const cardKey = await page.$eval('[data-card="shopRange"]', (el) => el.dataset.range);
    const card = `[data-card="shopRange"][data-range="${cardKey}"]`;
    await page.evaluate(async (key) => { const store = await import('./js/store.js'); const row = await store.getShopping(key); row.checked = {}; row.fold = {}; row.custom = []; await store.saveShopping(row); }, cardKey);
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

    const sections = await page.$$eval(`${card} .shop-section:not(.custom-section):not(.pantry-section)`, (els) => els.map((e) => ({ sec: e.dataset.section, n: e.querySelectorAll('.shop-row').length })));
    ok(sections.length >= 2, `（母體）這張卡有 ${sections.length} 個分區`);
    const initial = [];
    for (const s of sections) initial.push(await secState(s.sec));
    everyOf(initial, (s) => s.open === 'true' && s.hidden === false, '什麼都還沒買 → 每一區都展開');
    everyOf(initial, (s) => s.toggleH >= 44, '每一區的標題按得到（≥ 44px）');
    everyOf(initial, (s) => s.controls, 'aria-controls 指到它控制的那一塊');

    const target = [...sections].filter((s) => s.n >= 2).sort((a, b) => a.n - b.n)[0];
    ok(target, `（前提）挑一區至少兩項的：「${target?.sec}」${target?.n} 項`);
    const other = sections.find((s) => s.sec !== target.sec);
    const tRows = initial[sections.indexOf(target)].rows;
    for (const id of tRows) {
      await click(`${card} .shop-row[data-buy="${id}"] input[type="checkbox"]`);
      await sleep(250);
    }
    await sleep(300);
    const done1 = await secState(target.sec);
    eq(done1.open, 'false', `「${target.sec}」每一項都勾了「買了」→ 自動收合`);
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
      const { ranges } = buildShoppingList({ plan, recipesById: new Map(store.allRecipes().map((x) => [x.id, x])), members: store.members(), idx: store.foodsIndex(), units: store.units(), shoppingDays: prefs.get('shoppingDays') ?? [], fromDate: isoDate(new Date()) });
      const r = ranges.find((x) => x.key === key);
      const row = await store.getShopping(key);
      row.checked = Object.fromEntries(r.items.map((it) => [it.foodId, true]));
      row.fold = {}; row.custom = [];
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
    // 2026-09-16 使用者要求主畫面只留日期與進度：三顆按鈕收進日期的摺疊裡，所以收合時它們也跟著收起來。
    eq(cs.addH, 0, '整張卡收合 → 「自己加一項」也跟著收起來');

    await page.evaluate(async (key) => { const store = await import('./js/store.js'); const row = await store.getShopping(key); row.checked = {}; row.fold = {}; await store.saveShopping(row); }, cardKey);
  }

  section('買菜頁控制項：沒有超連結樣式、摺疊有明顯箭頭、常備品同一套摺疊、底下三顆按鈕對齊');
  {
    // 使用者回報三項：橘色帶底線的「刪除」看起來像超連結；摺疊的小三角形不明顯、
    // 常備品只是一行標題跟其他分類不一致；底下「自己加一項」「複製清單」「印出」寬度排列不一致。
    const vp0 = page.viewport();
    const alphaOf = (col) => { const m = /rgba?\(([^)]+)\)/.exec(col ?? ''); if (!m) return 1; const p = m[1].split(',').map((x) => Number(x.trim())); return p.length === 4 ? p[3] : 1; };
    const cardKey = await page.$eval('[data-card="shopRange"]', (el) => el.dataset.range);
    const card = `[data-card="shopRange"][data-range="${cardKey}"]`;
    const reloadCard = async () => { await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForSelector(`${card} .shop-section`); await sleep(300); };
    // 放一項自己加的（才量得到「刪除」）；其他狀態清乾淨
    await page.evaluate(async (key) => { const store = await import('./js/store.js'); const row = await store.getShopping(key); row.checked = {}; row.fold = {}; row.custom = [{ id: 'c-look', name: '蘋果', qty: '3 顆' }]; await store.saveShopping(row); }, cardKey);
    await reloadCard();

    const looks = () => page.evaluate((c) => {
      const look = (b) => {
        const cs = getComputedStyle(b);
        return { tag: b.tagName, btn: b.classList.contains('btn'), underline: cs.textDecorationLine.includes('underline'),
          border: parseFloat(cs.borderTopWidth) >= 1 && cs.borderTopStyle !== 'none', bg: cs.backgroundColor, color: cs.color,
          weight: Number(cs.fontWeight), h: Math.round(b.getBoundingClientRect().height), pressed: b.getAttribute('aria-pressed'), food: b.dataset.food };
      };
      const el = document.querySelector(c);
      // 整頁掃：可點的東西沒有一個長得像超連結。「數量」那顆除外 —— 它是點數字改數量，刻意用虛線底線標出
      // 「這個數字可以改」，而且改過的用實線底線（色弱的人分得出來），跟超連結是不同的東西。
      const linkish = [...document.querySelectorAll('#view button, #view a, #view summary')]
        .filter((b) => b.getBoundingClientRect().height > 0 && b.dataset.action !== 'editQty')
        .filter((b) => getComputedStyle(b).textDecorationLine.includes('underline') || b.classList.contains('linklike'))
        .map((b) => b.textContent.trim().slice(0, 12));
      return { scanned: document.querySelectorAll('#view button, #view a, #view summary').length, del: [...el.querySelectorAll('[data-action="deleteCustom"]')].map(look), linkish };
    }, card);
    const l1 = await looks();
    ok(l1.scanned >= 20, `（母體）整頁掃了 ${l1.scanned} 個可點的東西`);
    eq(l1.del.length, 1, '（前提）自己加的那一項有「刪除」可以量');
    everyOf(l1.del, (b) => b.tag === 'BUTTON' && b.btn && !b.underline && b.border, '「刪除」也是有外框的小按鈕，不是超連結樣式');
    everyOf(l1.del, (b) => alphaOf(b.bg) === 0 && b.color !== 'rgb(214, 69, 69)', `「刪除」是低調的危險色（透明底、字色 ${l1.del[0]?.color}，不是整顆大紅）`);
    everyOf(l1.del, (b) => b.h >= 44, '「刪除」按得到（≥ 44px）');
    eq(l1.linkish, [], '整頁沒有其他長得像超連結的控制項（「數量」那顆除外，見上面說明）');


    // 摺疊標題：每一個都有箭頭圖示、跟狀態一致、夠大、有底色；分類標題整條有淺底
    const folds = await page.evaluate((c) => [...document.querySelectorAll(`${c} [data-action="fold"]`)].map((t) => {
      const caret = t.querySelector('.fold-caret');
      const r = caret?.getBoundingClientRect();
      return { key: t.dataset.fold, open: t.getAttribute('aria-expanded'), caret: caret?.textContent ?? null,
        ratio: r ? r.width / parseFloat(getComputedStyle(t).fontSize) : 0, caretBg: caret ? getComputedStyle(caret).backgroundColor : '',
        inSection: !!t.closest('.shop-section-title'), barBg: getComputedStyle(t).backgroundColor, h: Math.round(t.getBoundingClientRect().height) };
    }), card);
    ok(folds.length >= 4, `（母體）這張卡有 ${folds.length} 個摺疊標題（整張卡、各分類、自己加的、常備品）`);
    ok(folds.some((f) => f.open === 'false') && folds.some((f) => f.open === 'true'), '（前提）收合與展開兩種狀態都量得到');
    everyOf(folds, (f) => f.caret !== null, '每一個摺疊標題都有箭頭圖示');
    everyOf(folds, (f) => f.caret === (f.open === 'true' ? '▾' : '▸'), '箭頭跟狀態一致：展開 ▾、收合 ▸',
      folds.filter((f) => f.caret !== (f.open === 'true' ? '▾' : '▸')).map((f) => `${f.key}：${f.open} 卻是 ${f.caret}`).join('、'));
    everyOf(folds, (f) => f.ratio >= 1.4, `箭頭圖示夠大（最小是字寬的 ${Math.min(...folds.map((f) => f.ratio)).toFixed(2)} 倍，≥ 1.4）`);
    everyOf(folds, (f) => alphaOf(f.caretBg) > 0, '箭頭圖示有底色（不是一個小小的灰色三角形）');
    const secFolds = folds.filter((f) => f.inSection);
    ok(secFolds.length >= 3, `（母體）分類標題 ${secFolds.length} 個`);
    everyOf(secFolds, (f) => alphaOf(f.barBg) > 0, '分類標題整條有淺底色，看得出是一列可以點的東西');
    everyOf(folds, (f) => f.h >= 44, '摺疊標題都按得到（≥ 44px）');

    // 常備品：同一套摺疊、預設收合、摘要講用完再補
    const pantryOf = () => page.evaluate((c) => {
      const box = document.querySelector(`${c} [data-field="pantry"]`);
      if (!box) return null;
      const t = box.querySelector('[data-action="fold"]');
      const body = t ? document.getElementById(t.getAttribute('aria-controls')) : null;
      return { details: box.tagName === 'DETAILS' || !!box.querySelector('details'), section: box.classList.contains('shop-section'), toggle: !!t,
        open: t?.getAttribute('aria-expanded'), hidden: body?.hidden, h: Math.round(body?.getBoundingClientRect().height ?? -1),
        caret: t?.querySelector('.fold-caret')?.textContent ?? null, summary: box.querySelector('[data-field="foldSummary"]')?.textContent ?? '', list: body?.textContent ?? '' };
    }, card);
    const p1 = await pantryOf();
    ok(p1, '（前提）有常備品那一區');
    eq(p1.details, false, '常備品不再是一行 <details> 標題');
    ok(p1.section && p1.toggle, '跟其他分類同一套摺疊（.shop-section＋摺疊鈕）');
    eq([p1.open, p1.hidden, p1.h], ['false', true, 0], '常備品預設收起來（用完再補，不用每次買）');
    eq(p1.caret, '▸', '收起來的常備品箭頭是 ▸');
    ok(/用完再補/.test(p1.summary), `摘要講用完再補，而不是「還差 N 項」：「${p1.summary}」`);
    ok(/鹽|沙拉油|醬油/.test(p1.list), '內容還在（只是收起來）');
    await page.evaluate((c) => document.querySelector(`${c} [data-field="pantry"] [data-action="fold"]`).click(), card);
    await sleep(300);
    const p2 = await pantryOf();
    eq([p2.open, p2.hidden, p2.caret], ['true', false, '▾'], '點一下就展開，箭頭變 ▾');
    await reloadCard();
    eq((await pantryOf()).open, 'true', '重新整理後，手動展開的常備品還是開著');

    // 底下三顆按鈕：手機上「自己加一項」佔滿第一列、下面兩顆等寬並排，左右緣對齊；桌機三顆等寬一列
    const measureActions = () => page.evaluate((c) => {
      const box = document.querySelector(`${c} [data-field="shopActions"]`);
      const rect = (sel) => { const r = box.querySelector(sel).getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height }; };
      const cr = document.querySelector(c).getBoundingClientRect();
      return { a: rect('[data-action="addCustom"]'), c: rect('[data-action="copyList"]'), p: rect('[data-action="print"]'), cardL: cr.left, cardR: cr.right };
    }, card);
    for (const [w, scale] of [[390, 'md'], [320, 'xl']]) {
      await page.setViewport({ width: w, height: 900 });
      await page.evaluate(async (s) => { const prefs = await import('./js/prefs.js'); await prefs.set('fontScale', s); prefs.applyFontScale(s); }, scale);
      await sleep(300);
      const m = await measureActions();
      ok(Math.min(m.a.h, m.c.h, m.p.h) >= 44, `${w}px／${scale}：三顆都按得到（最小 ${Math.round(Math.min(m.a.h, m.c.h, m.p.h))}px）`);
      ok(Math.abs(m.c.t - m.p.t) <= 2 && m.p.l >= m.c.r - 1, `${w}px／${scale}：「複製清單」「印出」同一列並排`);
      ok(Math.abs(m.c.w - m.p.w) <= 2, `${w}px／${scale}：兩顆一樣寬（${Math.round(m.c.w)}／${Math.round(m.p.w)}px）`);
      ok(m.a.b <= m.c.t + 1, `${w}px／${scale}：「自己加一項」在上面自成一列`);
      ok(Math.abs(m.a.l - m.c.l) <= 1 && Math.abs(m.a.r - m.p.r) <= 1, `${w}px／${scale}：「自己加一項」左右緣跟下面兩顆對齊（左差 ${Math.round(Math.abs(m.a.l - m.c.l))}、右差 ${Math.round(Math.abs(m.a.r - m.p.r))}px）`);
      ok(m.a.l >= m.cardL - 1 && m.p.r <= m.cardR + 1, `${w}px／${scale}：都在卡片裡`);
    }
    await page.setViewport({ width: 1024, height: 900 });
    await page.evaluate(async () => { const prefs = await import('./js/prefs.js'); await prefs.set('fontScale', 'md'); prefs.applyFontScale('md'); });
    await sleep(300);
    const d = await measureActions();
    ok(Math.max(d.a.t, d.c.t, d.p.t) - Math.min(d.a.t, d.c.t, d.p.t) <= 2, '桌機 1024px：三顆排成一列');
    ok(Math.max(d.a.w, d.c.w, d.p.w) - Math.min(d.a.w, d.c.w, d.p.w) <= 2, `桌機 1024px：三顆一樣寬（${[d.a.w, d.c.w, d.p.w].map(Math.round).join('／')}px）`);
    await page.setViewport(vp0);

    await page.evaluate(async (key) => { const store = await import('./js/store.js'); const row = await store.getShopping(key); row.checked = {}; row.fold = {}; row.custom = []; await store.saveShopping(row); }, cardKey);
  }

  section('已經過去的清單不顯示；上面沒勾的「自己加的」搬到下一張（2026-09-18 Yolin 定案）');
  // 「今天星期幾」不能靠跑測試的當下（慣例 19）：開一個把今天固定在本週四的分頁。
  // 買菜日是週一、週四：週一那張（給週一到週三）整個過去了，週四那張是下一張還沒過的。
  {
    const mondayIso = mondayOf(isoDate(new Date()));
    const thursdayIso = addDays(mondayIso, 3);
    const keys = await page.evaluate(async () => {
      const store = await import('./js/store.js');
      const prefs = await import('./js/prefs.js');
      const { rangesOfPlan } = await import('./js/shopping.js');
      const { mondayOf, weekKeyOf, isoDate } = await import('./js/planner.js');
      const plan = await store.getPlan(weekKeyOf(mondayOf(isoDate(new Date()))));
      return rangesOfPlan(plan, prefs.get('shoppingDays') ?? []).map((r) => ({ key: r.key, dates: r.dates }));
    });
    const pastKey = mondayIso;
    ok(keys.some((k) => k.key === pastKey) && keys.some((k) => k.key === thursdayIso), `（前提）兩張清單：${keys.map((k) => k.key).join('、')}`);
    await page.evaluate(async (key) => {
      const store = await import('./js/store.js');
      const row = await store.getShopping(key);
      row.custom = [{ id: 'c-paper', name: '衛生紙', qty: '一串' }, { id: 'c-apple', name: '蘋果', qty: '3 顆' }];
      row.checked = { ...(row.checked ?? {}), 'custom:c-apple': true };
      await store.saveShopping(row);
    }, pastKey);
    const p2 = await browser.newPage();
    p2.setDefaultTimeout(60000);
    try {
      await pinToday(p2, thursdayIso);
      await p2.goto(`http://localhost:${port}/#/shopping`, { waitUntil: 'networkidle0' });
      await p2.waitForSelector('[data-card="shopRange"]');
      await sleep(300);
      const read = () => p2.$$eval('[data-card="shopRange"]', (els) => els.map((e) => ({
        key: e.dataset.range, title: e.querySelector('.card-title').textContent.replace(/\s+/g, ' ').trim(),
        customs: [...e.querySelectorAll('[data-custom]')].map((c) => c.textContent.replace(/\s+/g, ' ').trim()),
      })));
      const cards = await read();
      eq(cards.map((c) => c.key), [thursdayIso], '站在週四：只剩週四那張，週一那張（給週一到週三的餐）不顯示');
      noneOf(cards, (c) => c.title.includes('已過'), '畫面上沒有任何「已過」的清單');
      ok(cards[0].customs.some((t) => t.includes('衛生紙')), `週一那張上沒勾的「衛生紙」搬到週四這張：${cards[0].customs.join('｜')}`);
      ok(!cards[0].customs.some((t) => t.includes('蘋果')), '已經勾掉的「蘋果」不搬');
      const stored = await p2.evaluate(async ([a, b]) => {
        const store = await import('./js/store.js');
        const from = await store.getShopping(a); const to = await store.getShopping(b);
        return { from: (from.custom ?? []).map((c) => c.name), to: (to.custom ?? []).map((c) => c.name) };
      }, [pastKey, thursdayIso]);
      eq(stored.from, ['蘋果'], '存檔：週一那張只剩已勾的蘋果（衛生紙真的搬走了，不是複製）');
      eq(stored.to.filter((n) => n === '衛生紙').length, 1, '存檔：週四那張有衛生紙');
      await p2.reload({ waitUntil: 'networkidle0' });
      await p2.waitForSelector('[data-card="shopRange"]');
      await sleep(300);
      const again = await read();
      eq(again[0].customs.filter((t) => t.includes('衛生紙')).length, 1, '重新整理之後衛生紙還是只有一筆（不會每開一次就再搬一次）');
    } finally {
      await p2.close();
      await page.evaluate(async (keys2) => {
        const store = await import('./js/store.js');
        for (const k of keys2) { const row = await store.getShopping(k); row.custom = []; row.checked = {}; await store.saveShopping(row); }
      }, [pastKey, thursdayIso]);
    }
  }

  eq(pageErrors, [], '沒有未攔截的例外');
} finally {
  await close();
}
done('shoppingviewtest');

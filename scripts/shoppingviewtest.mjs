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

  eq(pageErrors, [], '沒有未攔截的例外');
} finally {
  await close();
}
done('shoppingviewtest');

// 本週頁（npm run weekviewtest，puppeteer）：產生、素食成員都吃得了、為什麼選這道、換一道、鎖定後重新產生、外食、每日估計與目標對照。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ok, eq, section, done, everyOf, noneOf } from './tap.mjs';
import { openApp, acceptWelcome, goto, titleIs, textOf, sleep, clickEl, waitToastGone } from './browserlib.mjs';
import { versionFor } from '../js/members.js';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const recipes = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/recipes.json'), 'utf8')).recipes;
const byId = new Map(recipes.map((r) => [r.id, r]));

const mainIds = (page) => page.$$eval('.meal-item[data-role="main"]', (els) => els.map((e) => e.dataset.item));
const allItemIds = (page) => page.$$eval('.meal-item[data-item]', (els) => els.map((e) => e.dataset.item));

const { page, pageErrors, close } = await openApp();
try {
  await acceptWelcome(page);
  await page.evaluate(async () => {
    const store = await import('./js/store.js');
    const prefs = await import('./js/prefs.js');
    const { newMember } = await import('./js/members.js');
    await store.saveMember({ ...newMember(), name: '爸', diet: 'omni' });
    await store.saveMember({ ...newMember(), name: '阿嬤', ageGroup: 'senior', diet: 'lactoOvo', conditions: ['diabetes'], texture: 'soft', targets: { ...newMember().targets, carb: 180 } });
    await store.saveMember({ ...newMember(), name: '姊', diet: 'veganNoAllium' });
    await prefs.set('shoppingDays', [1, 4]);
  });

  section('產生本週');
  await goto(page, '#/family');
  await titleIs(page, '家人');
  await goto(page, '#/');
  await titleIs(page, '本週菜單');
  await page.waitForSelector('[data-card="weekEmpty"]');
  const emptyText = await textOf(page, '[data-card="weekEmpty"]');
  ok(emptyText.includes('爸（葷）') && emptyText.includes('姊（全素不含五辛）'), '空狀態列出家人');
  await clickEl(page, '[data-action="generate"]');
  await page.waitForSelector('[data-card="weekHead"]');
  eq(await page.$$eval('.meal-block', (els) => els.length), 21, '21 個餐格');
  const mains = await mainIds(page);
  eq(mains.length, 14, '14 個午晚餐都有主菜');
  const items = await allItemIds(page);
  ok(items.length >= 50, `（母體）${items.length} 道菜`);
  everyOf(items, (id) => byId.get(id) && versionFor(byId.get(id), 'lactoOvo') !== null && versionFor(byId.get(id), 'veganNoAllium') !== null, '每一道菜阿嬤（蛋奶素）與姊（全素不含五辛）都吃得了');
  noneOf(items, (id) => byId.get(id)?.vegMode === 'meatOnly', '沒有任何 meatOnly 的菜');
  ok(items.some((id) => byId.get(id)?.vegMode === 'splittable'), '（對照）有可分流的菜，爸吃葷版');
  const pageText = await textOf(page, '#view');
  noneOf(['建議攝取', '應該吃', '治療', '療效'], (w) => pageText.includes(w), '整頁沒有處方式的字');
  ok(!/\b(null|undefined|NaN)\b/.test(pageText), '沒有漏出 null／undefined／NaN');
  const diag = await page.$('[data-card="diagnostics"]');
  if (diag) {
    const t = await textOf(page, '[data-card="diagnostics"]');
    ok(/因為符合條件的菜不夠|排不出菜|放寬/.test(t), `有勉強排的地方就講清楚：${t.slice(0, 80)}`);
  } else ok(true, '這週沒有勉強排的地方（沒有 diagnostics 卡片）');

  section('為什麼選這道');
  await clickEl(page, '.meal-item[data-role="main"] .item-menu');
  await page.waitForSelector('.modal-card [data-field="reasons"] li');
  const reasons = await page.$$eval('.modal-card [data-field="reasons"] li', (els) => els.map((e) => e.textContent.trim()));
  ok(reasons.length >= 2, `${reasons.length} 條理由`);
  noneOf(reasons, (t) => /建議|應該|適合|療效|治療|控制|改善/.test(t), '理由沒有建議語氣或療效字眼');
  ok(reasons.some((t) => t.includes('姊（全素不含五辛）可吃')), '理由講出姊吃得了');
  ok(reasons.some((t) => /估 碳水化合物（醣）/.test(t)), '阿嬤留意醣 → 理由有醣的估計值與中位數比較');
  const firstMainBefore = mains[0];
  await clickEl(page, '.modal-card .modal-actions .btn:nth-of-type(2)');
  await waitToastGone(page).catch(() => {});
  await page.waitForFunction((prev) => document.querySelector('.meal-item[data-role="main"]')?.dataset.item !== prev, {}, firstMainBefore);
  const firstMainAfter = (await mainIds(page))[0];
  ok(firstMainAfter !== firstMainBefore && byId.get(firstMainAfter)?.role === 'main', `換一道：${byId.get(firstMainBefore)?.name} → ${byId.get(firstMainAfter)?.name}`);

  section('鎖定後重新產生');
  await clickEl(page, '.meal-item[data-role="main"] .item-menu');
  await page.waitForSelector('.modal-card .modal-actions');
  await page.evaluate(() => { [...document.querySelectorAll('.modal-card .modal-actions .btn')].find((b) => b.textContent.includes('鎖定這道'))?.click(); });
  await page.waitForSelector('.meal-item[data-role="main"] .lock');
  const lockedId = (await mainIds(page))[0];
  const beforeAll = await mainIds(page);
  await clickEl(page, '[data-action="regenerate"]');
  await page.waitForFunction(() => !document.querySelector('[data-action="regenerate"]')?.disabled);
  await sleep(300);
  const afterAll = await mainIds(page);
  eq(afterAll[0], lockedId, '鎖住的主菜重新產生後還是同一道');
  ok(await page.$('.meal-item[data-role="main"] .lock') != null, '鎖頭還在');
  ok(afterAll.some((id, i) => id !== beforeAll[i]), '（對照）沒鎖的主菜有變（換了 seed）');
  eq(afterAll.length, 14, '仍然 14 個主菜');

  section('外食');
  await clickEl(page, '.meal-block[data-meal="lunch"] [data-action="kind"]');
  await page.waitForSelector('.modal-card .modal-actions');
  await page.evaluate(() => { [...document.querySelectorAll('.modal-card .modal-actions .btn')].find((b) => b.textContent === '外食')?.click(); });
  await page.waitForSelector('.meal-block[data-meal="lunch"][data-kind="eatOut"]');
  const eatOut = await page.$eval('.meal-block[data-meal="lunch"][data-kind="eatOut"]', (el) => ({ items: el.querySelectorAll('.meal-item').length, text: el.textContent }));
  eq(eatOut.items, 0, '外食格沒有菜');
  ok(eatOut.text.includes('外食'), '寫著外食');
  eq((await mainIds(page)).length, 13, '主菜剩 13 個');

  section('每日估計與目標對照');
  await page.waitForSelector('[data-card="day"][data-day="0"] [data-field="dayEstimate"]');
  await page.$eval('[data-card="day"][data-day="0"] [data-field="dayEstimate"] summary', (el) => el.click());
  await sleep(150);
  const estRows = await page.$$eval('[data-card="day"][data-day="0"] .est-row', (els) => els.map((e) => ({ member: e.dataset.member, values: [...e.querySelectorAll('.nutri-value')].map((v) => v.textContent.trim()), targets: [...e.querySelectorAll('[data-target]')].map((t) => t.textContent) })));
  eq(estRows.map((r) => r.member), ['爸', '阿嬤', '姊'], '三位家人各一列');
  everyOf(estRows.flatMap((r) => r.values), (t) => /^估 /.test(t) || t.startsWith('未估算'), '每個數字帶「估」或「未估算」');
  const grandma = estRows.find((r) => r.member === '阿嬤');
  eq(grandma.targets.length, 1, '阿嬤有填醣的目標 → 一條對照');
  ok(grandma.targets[0].includes('醫師或營養師給的每日目標 180') && /今日估 [\d.]+/.test(grandma.targets[0]) && /\d+%/.test(grandma.targets[0]), `對照條講事實：${grandma.targets[0]}`);
  everyOf(estRows.filter((r) => r.member !== '阿嬤'), (r) => r.targets.length === 0, '沒填目標的家人沒有對照條（App 不替人設目標）');
  const dayText = await textOf(page, '[data-card="day"][data-day="0"]');
  ok(dayText.includes('阿嬤') && dayText.includes('（蛋奶素）'), '列出飲食型態');
  noneOf([dayText], (t) => /建議攝取|應該吃/.test(t), '每日估計沒有處方式的字');

  section('下週與重新載入');
  await page.reload({ waitUntil: 'networkidle0' });
  await titleIs(page, '本週菜單');
  await page.waitForSelector('[data-card="weekHead"]');
  eq((await mainIds(page)).length, 13, '重新載入後計畫還在（含外食那一格）');
  await clickEl(page, '[data-chips="week"] .chip[data-value="next"]');
  await page.waitForSelector('[data-card="weekEmpty"]');
  ok((await textOf(page, '[data-card="weekEmpty"]')).includes('產生下週菜單'), '下週還沒有計畫，按鈕寫「產生下週菜單」');

  eq(pageErrors, [], '沒有未攔截的例外');
} finally {
  await close();
}
done('weekviewtest');

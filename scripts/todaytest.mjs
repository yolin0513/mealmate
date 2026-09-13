// 今日一起煮（npm run todaytest，puppeteer）：時間線畫得出來、勾完成會存、換餐換天、
// **營養素版葷版兩欄分開、畫面上沒有兩版相加的數字**。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ok, eq, section, done, everyOf, noneOf } from './tap.mjs';
import { openApp, acceptWelcome, goto, titleIs, textOf, sleep, clickEl } from './browserlib.mjs';
import { indexFoods, NUTRIENT_LABELS } from '../js/foods.js';
import { fmtNutrient } from '../js/ui.js';
import { estimate } from '../js/nutrition.js';
import { buildTimeline } from '../js/timeline.js';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const foods = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/foods.json'), 'utf8'));
const aliases = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/aliases.json'), 'utf8'));
const recipes = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/recipes.json'), 'utf8')).recipes;
const idx = indexFoods(foods, aliases);
const byId = new Map(recipes.map((r) => [r.id, r]));

const { page, pageErrors, close } = await openApp();
try {
  await acceptWelcome(page);
  await page.evaluate(async () => {
    const store = await import('./js/store.js');
    const { newMember } = await import('./js/members.js');
    await store.saveMember({ ...newMember(), name: '爸', diet: 'omni' });
    await store.saveMember({ ...newMember(), name: '阿嬤', ageGroup: 'senior', diet: 'lactoOvo', conditions: ['diabetes'] });
  });

  section('還沒有菜單');
  await goto(page, '#/today');
  await titleIs(page, '今天一起煮');
  await page.waitForSelector('[data-card="todayEmpty"]');
  ok((await textOf(page, '[data-card="todayEmpty"]')).includes('還沒有菜單'), '空狀態講清楚');

  section('產生菜單後看得到時間線');
  await goto(page, '#/');
  await titleIs(page, '本週菜單');
  await clickEl(page, '[data-action="generate"]');
  await page.waitForSelector('[data-card="weekHead"]');
  // 找一格「有可分流的菜」的晚餐 —— 素葷兩欄才驗得到
  const target = await page.evaluate(async () => {
    const store = await import('./js/store.js');
    const { mondayOf, weekKeyOf, isoDate } = await import('./js/planner.js');
    const plan = await store.getPlan(weekKeyOf(mondayOf(isoDate(new Date()))));
    const all = store.allRecipes();
    const byId2 = new Map(all.map((r) => [r.id, r]));
    const slot = plan.slots.find((s) => s.kind === 'cook' && s.items.length > 1
      && s.items.some((it) => byId2.get(it.recipeId)?.vegMode === 'splittable'));
    return slot ? { date: slot.date, meal: slot.meal, items: slot.items.map((it) => it.recipeId), slot } : null;
  });
  ok(target, `（前提）找得到一格有可分流的菜：${target?.date} ${target?.meal}（${target?.items.join('、')}）`);

  await goto(page, `#/today?d=${target.date}&meal=${target.meal}`);
  await page.waitForSelector('[data-card="timeline"] .tl-step');
  const expected = buildTimeline({ slot: target.slot, recipesById: byId });
  const domSteps = await page.$$eval('[data-card="timeline"] .tl-step', (els) => els.map((e) => ({ id: e.dataset.step, dish: e.dataset.dish, text: e.querySelector('.tl-text').textContent.trim() })));
  eq(domSteps.map((s) => s.id), expected.groups.flatMap((g) => g.steps.map((s) => s.id)), '畫面上的步驟順序跟 buildTimeline 算的逐步相同');
  ok(domSteps.length >= 8, `（母體）${domSteps.length} 步`);
  everyOf(domSteps, (s) => s.text.length >= 4, '每一步都有文字');
  const phases = await page.$$eval('[data-card="timeline"] .tl-group', (els) => els.map((e) => e.dataset.phase));
  eq(phases, expected.groups.map((g) => g.phase), '階段順序也一樣');
  ok(phases.includes('prep') && phases.includes('cookBase'), `有備料與開火兩段（${phases.join('、')}）`);
  const pageText = await textOf(page, '#view');
  ok(!/\b(null|undefined|NaN)\b/.test(pageText), '沒有漏出 null／undefined／NaN');
  noneOf(['建議攝取', '應該吃', '療效', '治療'], (w) => pageText.includes(w), '沒有處方式的字');

  section('備料在開火之前、盛出素食份在素葷收尾之前（畫面上）');
  const phaseSpan = await page.$$eval('[data-card="timeline"] .tl-group', (els) => els.map((e) => ({ phase: e.dataset.phase, n: e.querySelectorAll('.tl-step').length })));
  const order = [];
  let acc = 0;
  for (const g of phaseSpan) { order.push({ phase: g.phase, from: acc, to: acc + g.n - 1 }); acc += g.n; }
  const seg = (p) => order.find((o) => o.phase === p);
  ok(seg('prep').to < seg('cookBase').from, `備料（第 1–${seg('prep').to + 1} 步）都在開火（第 ${seg('cookBase').from + 1} 步起）之前`);
  if (seg('split')) {
    ok(seg('cookBase').to < seg('split').from, '共同開火在盛出素食份之前');
    if (seg('veg')) ok(seg('split').to < seg('veg').from, '盛出素食份在素鍋收尾之前');
    if (seg('meat')) ok(seg('split').to < seg('meat').from, '盛出素食份在葷鍋收尾之前');
  } else ok(false, '（前提）這一格應該有可分流的菜，卻沒有盛出步驟');

  section('勾「完成」會存起來');
  const firstId = domSteps[0].id;
  await clickEl(page, `[data-step="${firstId}"] [data-action="stepDone"]`);
  await sleep(250);
  eq(await textOf(page, '[data-field="cookProgress"]'), `已完成 1／${domSteps.length} 步`, '進度變成 1');
  eq(await page.$eval(`[data-step="${firstId}"]`, (el) => el.dataset.done), '1', '那一步標成完成');
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('[data-card="timeline"] .tl-step');
  eq(await page.$eval(`[data-step="${firstId}"]`, (el) => el.dataset.done), '1', '重新載入後還在');
  eq(await page.$eval(`[data-step="${firstId}"] [data-action="stepDone"]`, (el) => el.getAttribute('aria-pressed')), 'true', '按鈕狀態也對');
  // 換一餐不會沿用別餐的勾
  const otherMeal = target.meal === 'dinner' ? 'lunch' : 'dinner';
  await goto(page, `#/today?d=${target.date}&meal=${otherMeal}`);
  await sleep(400);
  const otherProgress = await page.$('[data-field="cookProgress"]');
  if (otherProgress) ok((await textOf(page, '[data-field="cookProgress"]')).startsWith('已完成 0'), '另一餐的進度是 0（勾不會跨餐）');
  else ok(true, '另一餐沒有要煮（外食或不煮），本來就沒有進度');
  await goto(page, `#/today?d=${target.date}&meal=${target.meal}`);
  await page.waitForSelector('[data-card="timeline"] .tl-step');
  eq(await textOf(page, '[data-field="cookProgress"]'), `已完成 1／${domSteps.length} 步`, '回到原本那一餐，勾還在');

  section('營養：素版一欄、葷版一欄，畫面上沒有兩版相加的數字');
  const splitId = target.items.find((id) => byId.get(id)?.vegMode === 'splittable');
  await page.waitForSelector(`[data-dish="${splitId}"] .track`);
  const tracks = await page.$$eval(`[data-dish="${splitId}"] .track`, (els) => els.map((e) => ({
    track: e.dataset.track,
    label: e.querySelector('.track-label').textContent.trim(),
    values: [...e.querySelectorAll('.nutri-value')].map((v) => ({ k: v.dataset.nutrient, text: v.textContent.trim() })),
  })));
  eq(tracks.map((t) => t.track), ['veg', 'meat'], '兩欄：素版、葷版');
  ok(tracks[0].label.includes('素版') && tracks[1].label.includes('葷版'), `欄位標題寫清楚：「${tracks[0].label}」「${tracks[1].label}」`);
  everyOf(tracks.flatMap((t) => t.values), (v) => /^估 /.test(v.text) || v.text.includes('未估算'), '每個數字都帶「估」或寫未估算');
  ok((await textOf(page, '[data-field="splitNotice"]')).includes('不會相加'), '畫面上明講兩版不相加');

  // 紅線：這道菜兩欄顯示的，必須**逐欄位**等於各自那一軌自己算出來的值；
  // 而且都不可以是「素版＋葷版」。比對範圍限在這道菜的兩欄裡 ——
  // 拿整頁的數字去比會誤判（別道菜的蛋白質剛好等於這道的和，第一版就是這樣紅的）。
  const r = byId.get(splitId);
  const vegEst = estimate(r, idx, { version: 'veg' });
  const meatEst = estimate(r, idx, { version: 'meat' });
  const units = idx.units ?? {};
  const shownOf = (t, k) => (t.values.find((v) => v.k === k)?.text ?? '').replace('＊', '');
  const fields = tracks[0].values.map((v) => v.k);
  // 阿嬤有糖尿病 → 熱量、蛋白質 ＋ 醣、糖、膳食纖維
  eq(fields.slice(0, 2), ['kcal', 'protein'], '每一欄前兩項固定是熱量與蛋白質（預設就這兩項）');
  eq(fields, ['kcal', 'protein', 'carb', 'sugar', 'fiber'], '有糖尿病家人 → 留意項目加顯在同一欄裡');
  ok(fields.length >= 3, `（母體）兩欄各顯示 ${fields.length} 個欄位：${fields.join('、')}`);
  eq(tracks[1].values.map((v) => v.k), fields, '兩欄顯示的是同一組欄位');
  everyOf(fields, (k) => shownOf(tracks[0], k) === fmtNutrient(vegEst.perServing[k], units[k]), '素版那一欄逐欄位等於 estimate(veg)（base＋veg 軌 ÷ 素版份數）');
  everyOf(fields, (k) => shownOf(tracks[1], k) === fmtNutrient(meatEst.perServing[k], units[k]), '葷版那一欄逐欄位等於 estimate(meat)（base＋meat 軌 ÷ 葷版份數）');

  const bothPositive = fields.filter((k) => vegEst.perServing[k] > 0 && meatEst.perServing[k] > 0);
  ok(bothPositive.length >= 2, `（母體）${bothPositive.length} 個欄位兩版都不是 0 —— 它們的和一定大於任何一版，是真的「不該出現」的數字`);
  const sumTexts = bothPositive.map((k) => ({ k, text: fmtNutrient(vegEst.perServing[k] + meatEst.perServing[k], units[k]) }));
  everyOf(sumTexts, (s) => s.text !== fmtNutrient(vegEst.perServing[s.k], units[s.k]) && s.text !== fmtNutrient(meatEst.perServing[s.k], units[s.k]), '（前提）和跟兩版自己的數字都不一樣，所以下一條分得出來');
  const merged = sumTexts.filter((s) => shownOf(tracks[0], s.k) === s.text || shownOf(tracks[1], s.k) === s.text);
  eq(merged.map((m) => m.k), [], `**兩欄都沒有顯示素版＋葷版的和**（例如${NUTRIENT_LABELS[sumTexts[0].k]} 素 ${shownOf(tracks[0], sumTexts[0].k)}、葷 ${shownOf(tracks[1], sumTexts[0].k)}，和會是「${sumTexts[0].text}」）`);
  // 對照組：同一個檢查器，把和塞進素版那一欄就要抓得出來
  const poisoned = tracks.map((t, i) => (i === 0
    ? { ...t, values: t.values.map((v) => (v.k === sumTexts[0].k ? { ...v, text: sumTexts[0].text } : v)) }
    : t));
  eq(sumTexts.filter((s) => shownOf(poisoned[0], s.k) === s.text || shownOf(poisoned[1], s.k) === s.text).map((m) => m.k),
    [sumTexts[0].k], '（對照）把和塞進素版那一欄，同一個檢查器就抓得出來');

  section('外食那一餐沒有時間線');
  const eatOut = await page.evaluate(async (d) => {
    const store = await import('./js/store.js');
    const { mondayOf, weekKeyOf } = await import('./js/planner.js');
    const plan = await store.getPlan(weekKeyOf(mondayOf(d)));
    const i = plan.slots.findIndex((s) => s.date === d && s.meal === 'breakfast');
    plan.slots[i] = { ...plan.slots[i], kind: 'eatOut', items: [] };
    await store.savePlan(plan);
    return true;
  }, target.date);
  ok(eatOut, '（前提）把那天早餐改成外食');
  await goto(page, `#/today?d=${target.date}&meal=breakfast`);
  await page.waitForSelector('[data-card="todayEmpty"]');
  ok((await textOf(page, '[data-card="todayEmpty"]')).includes('外食'), '講出是外食，不是空白畫面');
  eq(await page.$$eval('.tl-step', (els) => els.length), 0, '沒有任何步驟');

  section('從本週頁點得到今天一起煮');
  await goto(page, '#/');
  await titleIs(page, '本週菜單');
  await page.waitForSelector('[data-action="cookToday"]');
  const links = await page.$$eval('[data-action="cookToday"]', (els) => els.map((e) => e.getAttribute('href')));
  ok(links.length >= 5, `（母體）${links.length} 天有「一起煮」的入口`);
  everyOf(links, (href) => /^#\/today\?d=\d{4}-\d{2}-\d{2}$/.test(href), '每個入口都帶那一天的日期');
  await clickEl(page, '[data-action="cookToday"]');
  await sleep(500);
  ok((await page.evaluate(() => location.hash)).startsWith('#/today'), '點下去到今日煮');

  section('換天');
  await page.waitForSelector('[data-action="nextDay"]');
  const before = await page.evaluate(() => location.hash);
  await clickEl(page, '[data-action="nextDay"]');
  await sleep(500);
  const after = await page.evaluate(() => location.hash);
  ok(before !== after && after.includes('#/today?d='), `後一天換得過去（${before} → ${after}）`);

  eq(pageErrors, [], '沒有未攔截的例外');
} finally {
  await close();
}
done('todaytest');

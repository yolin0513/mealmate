// 家人流程（npm run familytest，puppeteer）：首次說明 → 新增家人 → 留意欄位 → 買菜日 → 長輩模式 → 編輯／刪除。
//
// 紅線在畫面上的形狀：
//   · 腎臟病開了但沒勾子項 → 家人列沒有「留意：」；勾了糖尿病的家人列出醣、糖、膳食纖維
//   · 每日目標欄位載入時全是空字串、沒有帶數字的 placeholder；整頁沒有「建議攝取」「應該吃」

import { ok, eq, section, done, everyOf, noneOf } from './tap.mjs';
import { openApp, acceptWelcome, goto, titleIs, chipSel, textOf, sleep, clickEl } from './browserlib.mjs';

const { page, pageErrors, close } = await openApp();
try {
  section('首次說明');
  await page.waitForSelector('[data-card="welcome"]');
  eq(await textOf(page, '#topTitle'), '開始之前', '第一次開是說明頁');
  await acceptWelcome(page);
  eq(await textOf(page, '#topTitle'), '本週菜單', '按「我知道了」後進到本週');

  section('新增家人：腎臟病沒勾子項');
  await goto(page, '#/family/new');
  await titleIs(page, '新增家人');
  await page.waitForSelector('[data-field="name"]');
  const formText = await textOf(page, '#view');
  noneOf(['建議攝取', '應該吃', '治療'], (w) => formText.includes(w), '表單整頁沒有處方式的字');
  const targetInputs = await page.$$eval('[data-target]', (els) => els.map((e) => ({ k: e.dataset.target, value: e.value, placeholder: e.placeholder })));
  ok(targetInputs.length >= 5, `（母體）每日目標 ${targetInputs.length} 個欄位`);
  everyOf(targetInputs, (t) => t.value === '', '每日目標欄位載入時全是空字串');
  noneOf(targetInputs, (t) => /\d/.test(t.placeholder), '沒有任何帶數字的 placeholder（那等於偷塞預設值）');
  ok(formText.includes('不會自己建議目標'), '文案說 App 不會自己建議目標');

  await page.type('[data-field="name"]', '阿嬤');
  await clickEl(page, chipSel('diet', 'lactoOvo'));
  await clickEl(page, chipSel('ageGroup', 'senior'));
  await clickEl(page, '[data-pref="cond-kidney"]');
  await sleep(150);
  const subVisible = await page.$eval('.sub-block', (el) => !el.hidden);
  ok(subVisible, '開腎臟病後出現子項（鈉／鉀／磷／蛋白質）');
  const subChecked = await page.$$eval(chipSel('kidneyWatch', 'potassium').replace(' .chip[data-value="potassium"]', ' .chip.on'), (els) => els.length);
  eq(subChecked, 0, '子項預設全不勾');
  await clickEl(page, '[data-action="saveMember"]');
  await titleIs(page, '家人');
  await page.waitForSelector('[data-member]');
  const rows1 = await page.$$eval('[data-member]', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ')));
  eq(rows1.length, 1, '家人清單一位');
  ok(rows1[0].includes('阿嬤') && rows1[0].includes('蛋奶素') && rows1[0].includes('腎臟病'), `列出暱稱、飲食型態、留意項目：${rows1[0]}`);
  ok(!rows1[0].includes('留意：'), '腎臟病沒勾子項 → 沒有「留意：」欄位（不自動限鉀）');

  section('新增第二位：糖尿病');
  await goto(page, '#/family/new');
  await titleIs(page, '新增家人');
  await page.waitForSelector('[data-field="name"]');
  await page.type('[data-field="name"]', '爸');
  await clickEl(page, '[data-pref="cond-diabetes"]');
  await clickEl(page, '[data-action="saveMember"]');
  await titleIs(page, '家人');
  await page.waitForFunction(() => document.querySelectorAll('[data-member]').length === 2);
  const rows2 = await page.$$eval('[data-member]', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ')));
  const dad = rows2.find((t) => t.includes('爸'));
  ok(dad && dad.includes('留意：碳水化合物（醣）、糖、膳食纖維'), `糖尿病的家人列出留意欄位：${dad}`);

  section('食譜清單顯示家人的留意欄位');
  await goto(page, '#/recipes');
  await titleIs(page, '食譜');
  await page.waitForSelector('[data-list="recipes"] a.row');
  const watchNums = await page.$$eval('[data-list="recipes"] .watch-line .num[data-nutrient="carb"]', (els) => els.map((e) => e.textContent.trim()));
  ok(watchNums.length >= 30, `（母體）${watchNums.length} 列有醣的估計值`);
  everyOf(watchNums, (t) => /估 /.test(t) || t.includes('未估算'), '每一個都帶「估」字或寫「未估算」');
  noneOf(watchNums, (t) => /^碳水化合物（醣） 0(\.0)? g$/.test(t), '沒有任何一列是光禿禿的 0');

  section('買菜日');
  await goto(page, '#/family');
  await titleIs(page, '家人');
  await page.waitForSelector('[data-card="shoppingDays"] .day-btn');
  await clickEl(page, '[data-card="shoppingDays"] .day-btn[data-day="3"]');
  await clickEl(page, '[data-card="shoppingDays"] .day-btn[data-day="6"]');
  await sleep(200);
  eq(await textOf(page, '[data-field="shoppingDaysText"]'), '目前：星期三、六', '選了週三、週六');
  await page.reload({ waitUntil: 'networkidle0' });
  await titleIs(page, '家人');
  await page.waitForSelector('[data-field="shoppingDaysText"]');
  eq(await textOf(page, '[data-field="shoppingDaysText"]'), '目前：星期三、六', '重新載入後買菜日還在');
  const pressed = await page.$$eval('[data-card="shoppingDays"] .day-btn[aria-pressed="true"]', (els) => els.map((e) => e.dataset.day));
  eq(pressed, ['3', '6'], '按下狀態也對');

  section('長輩模式');
  await clickEl(page, '[data-pref="fontScale"]');
  await sleep(300);
  await page.waitForSelector('[data-card="display"]');
  eq(await page.evaluate(() => document.documentElement.dataset.fontScale), 'lg', '切到大字後 html 帶 data-font-scale=lg');
  await page.reload({ waitUntil: 'networkidle0' });
  await titleIs(page, '家人');
  eq(await page.evaluate(() => document.documentElement.dataset.fontScale), 'lg', '重新載入後仍是大字');
  const fs = await page.evaluate(() => getComputedStyle(document.body).fontSize);
  ok(parseFloat(fs) > 18, `body 字級 ${fs}（> 18px）`);

  section('編輯與刪除');
  const grandmaId = await page.$$eval('[data-member]', (els) => els.find((e) => e.textContent.includes('阿嬤'))?.dataset.member);
  ok(!!grandmaId, '找得到阿嬤的 id');
  await goto(page, `#/family/${grandmaId}`);
  await titleIs(page, '編輯：阿嬤');
  await page.waitForSelector('[data-field="name"]');
  await page.click('[data-field="name"]', { clickCount: 3 });
  await page.type('[data-field="name"]', '奶奶');
  await clickEl(page, '[data-action="saveMember"]');
  await titleIs(page, '家人');
  await page.waitForFunction(() => [...document.querySelectorAll('[data-member]')].some((e) => e.textContent.includes('奶奶')));
  ok(true && !(await page.evaluate(() => [...document.querySelectorAll('[data-member]')].some((e) => e.textContent.includes('阿嬤')))), '改名後清單是「奶奶」不是「阿嬤」');
  await goto(page, `#/family/${grandmaId}`);
  await titleIs(page, '編輯：奶奶');
  await clickEl(page, '[data-action="deleteMember"]');
  await page.waitForSelector('.modal-card .btn-danger');
  await clickEl(page, '.modal-card .btn-danger');
  await titleIs(page, '家人');
  await page.waitForFunction(() => document.querySelectorAll('[data-member]').length === 1);
  eq(await page.$$eval('[data-member]', (els) => els.length), 1, '刪除後剩一位');

  section('不存在的家人 id');
  await goto(page, '#/family/m-not-there');
  await titleIs(page, '家人');
  eq(await page.evaluate(() => location.hash), '#/family', '退回家人頁');

  eq(pageErrors, [], '整個流程沒有未攔截的例外');
} finally {
  await close();
}
done('familytest');

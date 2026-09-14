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
  // 要驗「真的看不到」，不是只驗 hidden 屬性：display:flex 的 class 會蓋掉 hidden（截圖走查抓到過）。
  const shownBox = (sel) => page.$eval(sel, (el) => { const cs = getComputedStyle(el); return cs.display !== 'none' && el.getBoundingClientRect().height > 0; });
  eq(await shownBox('.sub-block'), false, '腎臟病還沒開之前，子項（鈉／鉀／磷／蛋白質）是看不到的');
  eq(await shownBox('.err-box'), false, '沒有錯誤時，錯誤框看不到（不是一條空的紅框）');
  await clickEl(page, '[data-pref="cond-kidney"]');
  await sleep(150);
  eq(await shownBox('.sub-block'), true, '開腎臟病後出現子項（鈉／鉀／磷／蛋白質）');
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

  section('排菜規則：三個「避開」開關預設關');
  await page.waitForSelector('[data-card="rules"]');
  const avoidStates = await page.$$eval('[data-card="rules"] [data-pref^="avoid-"]', (els) => els.map((e) => ({ k: e.dataset.pref, on: e.getAttribute('aria-checked') })));
  eq(avoidStates.map((a) => a.k), ['avoid-sweet', 'avoid-processed', 'avoid-fried'], '三個開關');
  everyOf(avoidStates, (a) => a.on === 'false', '預設全關（留意項目只降分；排除由使用者自己開）');
  const rulesText = await textOf(page, '[data-card="rules"]');
  ok(rulesText.includes('不會排除') && rulesText.includes('預設全關'), '文案講清楚留意項目不排除、開關才排除');
  await clickEl(page, '[data-pref="avoid-sweet"]');
  await sleep(300);
  await page.waitForSelector('[data-card="rules"]');
  eq(await page.$eval('[data-pref="avoid-sweet"]', (el) => el.getAttribute('aria-checked')), 'true', '開了「避開精緻糖」');
  eq(await page.evaluate(async () => (await import('./js/prefs.js')).get('avoid')), { sweet: true, processed: false, fried: false }, 'prefs.avoid 只有 sweet 變 true');
  await page.reload({ waitUntil: 'networkidle0' });
  await titleIs(page, '家人');
  await page.waitForSelector('[data-card="rules"]');
  eq(await page.$eval('[data-pref="avoid-sweet"]', (el) => el.getAttribute('aria-checked')), 'true', '重新載入後仍是開的');
  await clickEl(page, '[data-pref="avoid-sweet"]');
  await sleep(300);

  section('不重複天數');
  await page.waitForSelector('[data-chips="noRepeat-main"] .chip');
  const groups = await page.$$eval('[data-card="rules"] [data-chips^="noRepeat-"]', (els) => els.map((e) => e.dataset.chips));
  eq(groups, ['noRepeat-main', 'noRepeat-side', 'noRepeat-soup'], '主菜、配菜、湯各一組（早餐與主食刻意沒有：白飯稀飯本來就天天吃）');
  eq(await page.$$eval('[data-chips="noRepeat-main"] .chip', (els) => els.map((e) => e.dataset.value)), ['7', '14', '21'], '主菜可以選 7／14／21 天');
  eq(await page.$eval('[data-chips="noRepeat-main"] .chip.on', (el) => el.dataset.value), '14', '預設是 14 天（跟 prefs 的預設一致）');
  const rulesText2 = await textOf(page, '[data-card="rules"]');
  ok(rulesText2.includes('還是會重複'), '文案講明菜不夠時還是會重複，不是保證');
  await clickEl(page, chipSel('noRepeat-main', '21'));
  await sleep(300);
  eq(await page.evaluate(async () => (await import('./js/prefs.js')).get('noRepeatDays')), { main: 21, side: 7, soup: 7, breakfast: 0, staple: 0 }, '只有主菜那一項變成 21，早餐與主食仍然是 0');
  await page.reload({ waitUntil: 'networkidle0' });
  await titleIs(page, '家人');
  await page.waitForSelector('[data-chips="noRepeat-main"] .chip.on');
  eq(await page.$eval('[data-chips="noRepeat-main"] .chip.on', (el) => el.dataset.value), '21', '重新載入後還是 21 天');
  await clickEl(page, chipSel('noRepeat-main', '14'));
  await sleep(300);

  section('一週豐盛程度：少 2／適中 4／多 6，預設適中，改了記得住');
  {
    // 使用者 2026-09-14 確認：把「一週排幾道豐盛的菜」的選擇權給使用者，預設適中。
    await page.waitForSelector('[data-chips="heartyLevel"] .chip');
    eq(await page.$$eval('[data-chips="heartyLevel"] .chip', (els) => els.map((e) => e.dataset.value)), ['low', 'medium', 'high'], '三段：少、適中、多');
    eq(await page.$$eval('[data-chips="heartyLevel"] .chip', (els) => els.map((e) => e.textContent.trim())), ['少（一週 2 道）', '適中（一週 4 道）', '多（一週 6 道）'], '每一段講得出一週幾道');
    eq(await page.$eval('[data-chips="heartyLevel"] .chip.on', (el) => el.dataset.value), 'medium', '預設是適中');
    eq(await page.evaluate(async () => (await import('./js/prefs.js')).DEFAULTS.heartyLevel), 'medium', 'prefs 的預設值也是適中');
    const hint = await textOf(page, '[data-field="heartyHint"]');
    ok(hint.includes('這是一般飲食常識的安排，不是營養處方。') && hint.includes('不會把菜拿掉'), `說明講清楚是傾向、不是排除、不是處方：「${hint}」`);
    noneOf(['健康', '降', '控制', '療效', '治療', '改善'], (w) => hint.includes(w), '說明沒有療效字眼（健康／降／控制…）');
    await clickEl(page, chipSel('heartyLevel', 'low'));
    await sleep(300);
    eq(await page.evaluate(async () => (await import('./js/prefs.js')).get('heartyLevel')), 'low', '點「少」→ prefs 記成 low');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await titleIs(page, '家人');
    await page.waitForSelector('[data-chips="heartyLevel"] .chip.on');
    eq(await page.$eval('[data-chips="heartyLevel"] .chip.on', (el) => el.dataset.value), 'low', '重新載入後還是「少」');
    await clickEl(page, chipSel('heartyLevel', 'medium'));
    await sleep(300);
  }

  section('字級：標準／大字／特大');
  await page.waitForSelector('[data-chips="fontScale"] .chip');
  const scaleOptions = await page.$$eval('[data-chips="fontScale"] .chip', (els) => els.map((e) => e.dataset.value));
  eq(scaleOptions, ['md', 'lg', 'xl'], '三段字級（特大是給看不清楚的長輩用的）');
  const bodyPx = () => page.evaluate(() => parseFloat(getComputedStyle(document.body).fontSize));
  const px = { md: await bodyPx() };
  for (const s of ['lg', 'xl']) {
    await clickEl(page, chipSel('fontScale', s));
    await sleep(300);
    await page.waitForSelector('[data-card="display"]');
    eq(await page.evaluate(() => document.documentElement.dataset.fontScale), s, `切到「${s}」後 html 帶 data-font-scale=${s}`);
    px[s] = await bodyPx();
  }
  ok(px.md < px.lg && px.lg < px.xl, `字級真的一段比一段大：${px.md} → ${px.lg} → ${px.xl} px`);
  ok(px.xl >= 21, `特大至少 21px（實際 ${px.xl}px）`);
  await page.reload({ waitUntil: 'networkidle0' });
  await titleIs(page, '家人');
  await page.waitForSelector('[data-chips="fontScale"] .chip.on');
  eq(await page.evaluate(() => document.documentElement.dataset.fontScale), 'xl', '重新載入後仍是特大');
  eq(await page.$eval('[data-chips="fontScale"] .chip.on', (el) => el.dataset.value), 'xl', '選中的那顆也對');
  await clickEl(page, chipSel('fontScale', 'md'));
  await sleep(300);

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

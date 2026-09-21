// 真實使用路徑走查（npm run scenariotest，puppeteer）。
//
// 其他測試多半是「單一功能對不對」；這一支照**一個人真的會怎麼用**走一遍，
// 每一步都問：畫面上有沒有他看不懂的東西、有沒有死路、數字有沒有自相矛盾。
//
//   A 第一次開啟（守門）→ B 只有一位家人 → C 加入素食成員 → D 加入慢性病成員
//   → E 跨週 → F 菜池不夠（三個避開開關全開）→ G 離線
//
// 換版那條路徑在 versionmixtest（裝舊版 SW、部署新版、提示列、按下去換版）。

import { ok, eq, section, done, everyOf, noneOf, note } from './tap.mjs';
import { openApp, acceptWelcome, goto, titleIs, textOf, sleep, clickEl, chipSel } from './browserlib.mjs';
import { forbiddenIn } from './copyrules.mjs';

const { page, pageErrors, srv, close } = await openApp();
const viewText = () => textOf(page, '#view');
const cardsOf = () => page.$$eval('#view [data-card]', (els) => els.map((e) => e.dataset.card));
const dishCount = () => page.$$eval('.meal-item[data-item]', (els) => els.length);

try {
  section('A 第一次開啟：先看說明，按過才進得去');
  eq(await textOf(page, '#topTitle'), '開始之前', '一開啟是說明頁');
  const welcomeText = await viewText();
  everyOf(['營養數字', '估', '醫師或營養師'], (t) => welcomeText.includes(t), '三句話都在（估計值、只影響顯示與排序、以醫囑為準）');
  for (const hash of ['#/shopping', '#/recipes', '#/family', '#/today']) {
    await goto(page, hash);
    await sleep(400);
    eq(await page.evaluate(() => location.hash), '#/welcome', `還沒按「我知道了」時 ${hash} 會被導回說明頁`);
  }
  await acceptWelcome(page);
  const emptyWeek = await viewText();
  everyOf(['家人', '買菜日', '產生菜單'], (t) => emptyWeek.includes(t), '空狀態就是三步：家人、買菜日、產生菜單');
  ok(emptyWeek.includes('沒有家人也能排'), '沒有家人也講得出會怎麼排（不是叫人先去設定）');

  section('B 只有一位家人：加一位，四個分頁都要說得通');
  await goto(page, '#/family/new');
  await titleIs(page, '新增家人');
  await page.type('[data-field="name"]', '媽');
  await clickEl(page, '[data-action="saveMember"]');
  await titleIs(page, '家人');
  await page.waitForSelector('[data-card="shoppingDays"] .day-btn');
  await clickEl(page, '[data-card="shoppingDays"] .day-btn[data-day="3"]');
  await sleep(200);
  await goto(page, '#/');
  await titleIs(page, '本週菜單');
  await clickEl(page, '[data-action="generate"]');
  await page.waitForSelector('[data-card="weekHead"]');
  const n1 = await dishCount();
  ok(n1 >= 60, `一週排了 ${n1} 道`);
  const weekText1 = await viewText();
  ok(!/\b(null|undefined|NaN)\b/.test(weekText1), '本週頁沒有漏出 null／undefined／NaN');
  await goto(page, '#/shopping');
  await titleIs(page, '買菜');
  await page.waitForSelector('[data-card="shopRange"]');
  const shopItems = await page.$$eval('.shop-row', (els) => els.length);
  ok(shopItems >= 20, `買菜頁有 ${shopItems} 項要買`);
  const shopText = await viewText();
  ok(shopText.includes('星期三'), '清單講出是依哪一天的買菜日分的');
  ok(!/\b(null|undefined|NaN)\b/.test(shopText), '買菜頁沒有漏出 null／undefined／NaN');

  section('C 加入素食成員：重排之後每一道她都吃得到');
  await goto(page, '#/family/new');
  await titleIs(page, '新增家人');
  await page.type('[data-field="name"]', '姊');
  await clickEl(page, chipSel('diet', 'veg'));
  for (const k of ['egg', 'dairy', 'allium']) await clickEl(page, chipSel('vegEats', k)); // 三個勾都取消＝全素
  await clickEl(page, '[data-action="saveMember"]');
  await titleIs(page, '家人');
  await goto(page, '#/');
  await titleIs(page, '本週菜單');
  await clickEl(page, '[data-action="regenerate"]');
  await sleep(1500);
  await page.waitForSelector('[data-card="weekHead"]');
  const vegCheck = await page.evaluate(async () => {
    const store = await import('./js/store.js');
    const { versionFor } = await import('./js/members.js');
    const { mondayOf, weekKeyOf, isoDate } = await import('./js/planner.js');
    const plan = await store.getPlan(weekKeyOf(mondayOf(isoDate(new Date()))));
    const byId = new Map(store.allRecipes().map((r) => [r.id, r]));
    const meals = plan.slots.filter((s) => s.kind === 'cook' && s.meal !== 'breakfast');
    return meals.map((s) => ({
      total: s.items.length,
      eat: s.items.filter((it) => versionFor(byId.get(it.recipeId), 'veganNoAllium') !== null).length,
      extras: s.items.filter((it) => it.extraMeat).length,
    }));
  });
  ok(vegCheck.length === 14, `（母體）${vegCheck.length} 個午晚餐`);
  everyOf(vegCheck, (m) => m.eat >= 3, `每一餐姊都吃得到 ≥ 3 道（最少 ${Math.min(...vegCheck.map((m) => m.eat))} 道）`);
  const labelled = await page.$$eval('.meal-item[data-extra="meat"]', (els) => els.length);
  const extraTotal = vegCheck.reduce((n, m) => n + m.extras, 0);
  eq(labelled, extraTotal, `畫面上標「僅葷食成員」的道數（${labelled}）跟計畫裡的加菜數一致`);

  // SPEC_排菜葷素比例：加了素食成員之後，午晚餐會多一道只有吃葷的人吃的純葷加菜。
  {
    const extras = await page.$$eval('.meal-item[data-extra="meat"]', (els) => els.length);
    ok(extras >= 5, `加入素食成員之後，這一週有 ${extras} 道「僅葷食成員」的加菜`);
  }

  // V8（2026-09-21）：真實入口驗 2026-09-21 補的九道全素無五辛配菜／湯真的排得到、畫面上看得見。
  // 前置先在瀏覽器端算這一週排到幾道（情境不成立就紅，不靜默跳過）；再到畫面上比對菜名。
  {
    const NEW_IDS = ['r-edamame-corn', 'r-braised-baiye-tofu', 'r-tofu-skin-bokchoy', 'r-mien-chang-pepper', 'r-cold-tofu-strips', 'r-frozen-tofu-cabbage',
      'r-kelp-tofu-soup', 'r-tofu-skin-cabbage-soup', 'r-edamame-corn-soup'];
    const newInWeek = await page.evaluate(async (ids) => {
      const store = await import('./js/store.js');
      const { mondayOf, weekKeyOf, isoDate } = await import('./js/planner.js');
      const plan = await store.getPlan(weekKeyOf(mondayOf(isoDate(new Date()))));
      const byId = new Map(store.allRecipes().map((r) => [r.id, r]));
      const hit = plan.slots.filter((s) => s.kind === 'cook').flatMap((s) => s.items)
        .filter((it) => ids.includes(it.recipeId));
      return { count: hit.length, names: [...new Set(hit.map((it) => byId.get(it.recipeId)?.name))] };
    }, NEW_IDS);
    ok(newInWeek.count >= 1, `（前提）姊改成全素之後重排，這一週排到 ${newInWeek.count} 道新補的配菜／湯：${newInWeek.names.join('、')}`);
    const onScreen = await page.$$eval('.meal-item .meal-name', (els) => els.map((e) => e.textContent.trim()));
    ok(newInWeek.names.some((n) => onScreen.includes(n)), `V8 那幾道在本週頁上看得到：${newInWeek.names.filter((n) => onScreen.includes(n)).join('、')}`);
    // 「這幾餐排不到蛋、豆製品或奶類的菜」那張卡（data-card="vegProteinMiss"，沒有缺的餐就整張不畫）。
    // 這裡不能只驗「卡不在」——卡不在也可能是選擇器打錯，所以連同計畫裡實際缺的餐數一起比對。
    const vpNow = await page.evaluate(async () => {
      const store = await import('./js/store.js');
      const { mondayOf, weekKeyOf, isoDate, vegProteinMisses } = await import('./js/planner.js');
      const plan = await store.getPlan(weekKeyOf(mondayOf(isoDate(new Date()))));
      const byId = new Map(store.allRecipes().map((r) => [r.id, r]));
      const misses = vegProteinMisses(plan, store.members(), byId, store.foodsIndex());
      const card = document.querySelector('[data-card="vegProteinMiss"]');
      return { misses: misses.length, cardText: card ? card.textContent.replace(/\s+/g, ' ').slice(0, 80) : null };
    });
    ok(vpNow.misses <= 3, `V8 這一週姊排不到蛋豆奶菜的午晚餐只剩 ${vpNow.misses} 餐（補菜之前同一份計畫是 2 餐以上；14 餐裡）`);
    ok(vpNow.misses === 0 ? vpNow.cardText === null : typeof vpNow.cardText === 'string',
      `V8 那張卡跟計畫一致：缺 ${vpNow.misses} 餐 → ${vpNow.cardText === null ? '整張卡不畫' : `卡上寫「${vpNow.cardText}」`}`);
  }

  section('D 加入慢性病成員：留意欄位一路跟著出現');
  await goto(page, '#/family/new');
  await titleIs(page, '新增家人');
  await page.type('[data-field="name"]', '阿嬤');
  // 2026-09-16：慢性病改成搜尋式挑選
  await page.focus('[data-field="condSearch"]');
  await page.type('[data-field="condSearch"]', '糖尿病');
  await sleep(200);
  await clickEl(page, '[data-cond="diabetes"]');
  await sleep(150);
  await clickEl(page, '[data-action="saveMember"]');
  await titleIs(page, '家人');
  const memberRow = await page.$$eval('[data-member]', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ')));
  ok(memberRow.some((t) => t.includes('留意：碳水化合物（醣）、糖、膳食纖維')), '家人列出留意欄位');
  await goto(page, '#/recipes');
  await titleIs(page, '食譜');
  await page.waitForSelector('[data-list="recipes"] .watch-line');
  const listWatch = await page.$$eval('[data-list="recipes"] .watch-line .num', (els) => els.map((e) => e.dataset.nutrient));
  ok(listWatch.length >= 30, `（母體）食譜清單 ${listWatch.length} 個留意欄位數字`);
  everyOf([...new Set(listWatch)], (k) => ['carb', 'sugar', 'fiber'].includes(k), '清單上顯示的就是那三項');
  await goto(page, '#/');
  await titleIs(page, '本週菜單');
  await page.waitForSelector('[data-card="day"][data-day="0"] [data-field="dayEstimate"]');
  const estFields = await page.$$eval('[data-card="day"][data-day="0"] .est-row', (els) => [...els[0].querySelectorAll('.nutri-value')].map((e) => e.dataset.nutrient));
  eq([...estFields].sort(), ['carb', 'fiber', 'kcal', 'protein', 'sugar'], '每日估算也跟著多那三項');

  section('E 跨週：下週是另一份菜單，本週不受影響');
  const thisWeekIds = await page.$$eval('.meal-item[data-item]', (els) => els.map((e) => e.dataset.item));
  await goto(page, '#/?w=next');
  await titleIs(page, '本週菜單');
  await page.waitForSelector('[data-action="generate"]');
  ok((await viewText()).includes('下週'), '下週還沒有菜單時講清楚');
  await clickEl(page, '[data-action="generate"]');
  await page.waitForSelector('[data-card="weekHead"]');
  const nextIds = await page.$$eval('.meal-item[data-item]', (els) => els.map((e) => e.dataset.item));
  ok(nextIds.length >= 60, `下週也排了 ${nextIds.length} 道`);
  ok(JSON.stringify(nextIds) !== JSON.stringify(thisWeekIds), '下週不是把這週複製一份');
  await goto(page, '#/');
  await titleIs(page, '本週菜單');
  await page.waitForSelector('[data-card="weekHead"]');
  eq(await page.$$eval('.meal-item[data-item]', (els) => els.map((e) => e.dataset.item)), thisWeekIds, '回到本週，菜單原封不動');
  await goto(page, '#/shopping?w=next');
  await titleIs(page, '買菜');
  await page.waitForSelector('[data-card="shopRange"]');
  ok((await page.$$eval('.shop-row', (els) => els.length)) > 0, '下週的買菜清單也出得來');

  section('F 菜池不夠：三個避開開關全開，要講清楚而不是靜默');
  await goto(page, '#/family');
  await titleIs(page, '家人');
  for (const k of ['avoid-sweet', 'avoid-processed', 'avoid-fried']) {
    await clickEl(page, `[data-pref="${k}"]`);
    await sleep(350);
    await page.waitForSelector('[data-card="rules"]');
  }
  await goto(page, '#/');
  await titleIs(page, '本週菜單');
  await clickEl(page, '[data-action="regenerate"]');
  await sleep(1500);
  await page.waitForSelector('[data-card="weekHead"]');
  const diag = await page.evaluate(async () => {
    const store = await import('./js/store.js');
    const { mondayOf, weekKeyOf, isoDate } = await import('./js/planner.js');
    const plan = await store.getPlan(weekKeyOf(mondayOf(isoDate(new Date()))));
    return plan.diagnostics;
  });
  const n2 = await dishCount();
  ok(n2 >= 55, `開了三個避開開關之後還是排得出 ${n2} 道（不是整個空掉）`);
  const hasDiag = (diag.forcedRepeats.length + diag.relaxed.length + diag.empty.length + (diag.noMeat?.length ?? 0)) > 0;
  const diagCard = await page.$('[data-card="diagnostics"]');
  eq(!!diagCard, hasDiag, `有勉強排的地方（重複 ${diag.forcedRepeats.length}、放寬 ${diag.relaxed.length}、空 ${diag.empty.length}、無葷 ${diag.noMeat?.length ?? 0}）就一定有那張說明卡，沒有就不出現`);
  if (diagCard) {
    const t = await textOf(page, '[data-card="diagnostics"]');
    ok(/因為符合條件的菜不夠|放寬|排不出菜|沒有排到葷菜/.test(t), `說明卡講得出原因：${t.slice(0, 70)}`);
    eq(forbiddenIn(t), [], '而且沒有處方語氣');
  } else note('這次三個開關全開仍然沒有任何勉強排的地方 —— 菜池夠大');
  // 開關關回去
  await goto(page, '#/family');
  await titleIs(page, '家人');
  for (const k of ['avoid-sweet', 'avoid-processed', 'avoid-fried']) {
    await clickEl(page, `[data-pref="${k}"]`);
    await sleep(350);
    await page.waitForSelector('[data-card="rules"]');
  }
  eq(await page.evaluate(async () => (await import('./js/prefs.js')).get('avoid')), { sweet: false, processed: false, fried: false }, '三個開關關得回去');

  section('G 離線：SW 接手之後拔網路，四個分頁都還開得起來');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    for (let i = 0; i < 60 && !navigator.serviceWorker.controller; i += 1) await new Promise((r) => setTimeout(r, 100));
  });
  ok(await page.evaluate(() => !!navigator.serviceWorker.controller), '（前提）Service Worker 已經接手');
  await page.setOfflineMode(true);
  srv.close();
  await sleep(300);
  const netDead = await page.evaluate(async () => {
    try { await fetch(`./no-such-file-${Date.now()}`); return false; } catch { return true; }
  });
  ok(netDead, '（對照）網路真的斷了 —— 底下的離線斷言才算數');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#view .card', { timeout: 60000 });
  for (const [hash, title, wait] of [['#/', '本週菜單', '[data-card="weekHead"]'], ['#/shopping', '買菜', '[data-card="shopRange"]'],
    ['#/recipes', '食譜', '[data-list="recipes"] a.row'], ['#/family', '家人', '[data-card="about"]']]) {
    await goto(page, hash);
    await titleIs(page, title);
    await page.waitForSelector(wait, { timeout: 60000 });
    const cards = await page.$$eval('#view .card', (els) => els.length);
    ok(cards > 0, `離線也開得起來：${title}（${cards} 張卡片）`);
  }
  const offlineText = await viewText();
  ok(!/\b(null|undefined|NaN)\b/.test(offlineText), '離線時畫面也沒有漏出 null／undefined／NaN');
  noneOf([offlineText], (t) => /載入失敗|無法連線|錯誤/.test(t), '離線時沒有跳出嚇人的錯誤訊息（資料本來就都在本機）');
  await page.setOfflineMode(false);

  eq(pageErrors, [], '整段走查沒有未攔截的例外');
} finally {
  try { srv.close(); } catch { /* 已經關了 */ }
  await close();
}
done('scenariotest');

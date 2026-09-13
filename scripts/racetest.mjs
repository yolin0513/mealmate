// 非同步畫面競態（npm run racetest）。沿用 StockDiary／TripQuest 那一套。
//
// 每個 view 都長這樣：`await import(...)` → `await 讀 IndexedDB` → `render(...)`。
// 中間那幾個 await 在手機上輕易就是幾百毫秒到幾秒。這段時間裡使用者只要換了頁，
// 舊的 view 醒來之後還是會把自己畫上去 —— **最後畫完的那個贏**，網址是新的、畫面是舊的。
// 使用者在 StockDiary 回報過這個症狀：「點『管理定期定額計畫』會直接跳回主頁」。
//
// MealMate 的 js/router.js 從 M0 就抄了那套守門（gen／paintGen ＋ runLatest 迴圈），
// 這支測試把它撐開到穩定可測，證明守門真的在擋 —— 不是靠推論。
// 突變「renderIsStale() 永遠回 false」會讓這裡紅。
//
// MealMate 沒有「開機後自動重畫首頁」那條路徑（沒有任何模組訂閱 store 之後自己 import 一頁來畫），
// 所以不抄 StockDiary 那一節；剩下三條在這裡都有對應。

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { ok, eq, section, done, note } from './tap.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
};

/** 靜態檔伺服器，另外接受「哪個請求要慢幾毫秒」的規則。 */
function delayServer(delayFor) {
  const srv = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const full = path.resolve(ROOT, '.' + rel);
    const send = () => {
      if (!full.startsWith(ROOT)) { res.writeHead(403); res.end('forbidden'); return; }
      fs.readFile(full, (err, buf) => {
        if (err) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); res.end('not found'); return; }
        res.writeHead(200, { 'content-type': TYPES[path.extname(full).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store' });
        res.end(buf);
      });
    };
    const ms = delayFor(req.url) || 0;
    if (ms > 0) setTimeout(send, ms); else send();
  });
  return new Promise((resolve) => { srv.listen(0, () => resolve({ srv, port: srv.address().port })); });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 現在畫面上是哪一頁？用每一頁獨有的標記判斷。
// 少了「前提」那一節的話，標記一改名這裡就全部認不出來，而所有否定斷言會變成永遠成立 —— 假斷言。
const WHICH_SRC = `window.__which = function () {
  const v = document.getElementById('view');
  if (!v) return 'none';
  if (v.querySelector('[data-card="welcome"]')) return 'welcome';
  if (v.querySelector('[data-card="timeline"], [data-card="todayEmpty"]')) return 'today';
  if (v.querySelector('[data-card="shoppingEmpty"], [data-card="shoppingHead"]')) return 'shopping';
  if (v.querySelector('[data-card="recipeNutrition"]')) return 'recipe';
  if (v.querySelector('[data-list="recipes"]')) return 'recipes';
  if (v.querySelector('[data-card="about"]')) return 'family';
  if (v.querySelector('[data-card="weekEmpty"], [data-card="weekHead"]')) return 'week';
  return v.textContent.trim().slice(0, 30) || 'empty';
};`;

const snapshot = (page) => page.evaluate(() => ({
  hash: decodeURIComponent(location.hash),
  which: window.__which(),
  title: document.getElementById('topTitle').textContent,
}));

async function openApp(browser, port) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  page.setDefaultTimeout(60000);
  page.setDefaultNavigationTimeout(60000);
  await page.setViewport({ width: 390, height: 844 });
  await page.evaluateOnNewDocument(WHICH_SRC);
  await page.goto(`http://localhost:${port}/`, { waitUntil: 'domcontentloaded' });
  // 首次說明的守門：按過「我知道了」之後才進得了其他頁
  await page.waitForSelector('[data-action="acceptDisclaimer"]', { timeout: 60000 });
  await page.click('[data-action="acceptDisclaimer"]');
  await page.waitForFunction(() => window.__which() === 'week', { timeout: 60000 });
  return { ctx, page };
}

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  section('前提：每一頁各自認得出來');
  {
    const { srv, port } = await delayServer(() => 0);
    const { ctx, page } = await openApp(browser, port);
    const got = {};
    for (const [hash, name] of [['#/', 'week'], ['#/shopping', 'shopping'], ['#/recipes', 'recipes'], ['#/family', 'family'], ['#/today', 'today']]) {
      await page.evaluate((x) => { location.hash = x; }, hash);
      await sleep(900);
      got[name] = await page.evaluate(() => window.__which());
    }
    eq(got, { week: 'week', shopping: 'shopping', recipes: 'recipes', family: 'family', today: 'today' },
      '五頁各自畫出自己的標記 —— 下面的斷言才分得出誰蓋掉誰');
    await ctx.close(); srv.close();
  }

  section('慢的舊畫面不准蓋掉使用者現在這一頁');
  {
    // 買菜頁慢 1.5 秒：使用者點了買菜、還沒畫出來就改點家人。
    // （目標頁不用食譜頁 —— 本週頁的 weekops.js 會 import recipes.js，它早就載好了，
    //   拿它當「另一頁」測不到真正的競態。）
    const { srv, port } = await delayServer((u) => (u.startsWith('/js/views/shopping.js') ? 1500 : 0));
    const { ctx, page } = await openApp(browser, port);
    await page.evaluate(() => { location.hash = '#/shopping'; });
    await sleep(200);
    await page.evaluate(() => { location.hash = '#/family'; });
    await sleep(3000); // 遠超過那 1.5 秒，慢的那個一定已經回來了
    const after = await snapshot(page);
    eq(after.hash, '#/family', '網址停在使用者最後選的那一頁');
    eq(after.which, 'family', '畫面也是那一頁 —— 慢吞吞的買菜頁醒來之後不准畫上去');
    ok(!after.title.includes('買菜'), `連頂列標題都沒有被舊畫面改掉（現在是「${after.title}」）`);
    await ctx.close(); srv.close();
  }

  section('等待新畫面的期間，不准先閃出使用者沒選的那一頁');
  {
    // 只看「塵埃落定後停在哪」的話，一個「先畫錯的再畫對的」實作也會過 ——
    // 使用者眼前還是會閃一下別頁。這一節在中間取樣：
    //   0.0s 點買菜 → 0.2s 改點家人 → 1.5s 買菜載完（不准畫）→ 3.5s 家人載完（才可以畫）
    const { srv, port } = await delayServer((u) => {
      if (u.startsWith('/js/views/shopping.js')) return 1500;
      if (u.startsWith('/js/views/family.js')) return 3500;
      return 0;
    });
    const { ctx, page } = await openApp(browser, port);
    await page.evaluate(() => { location.hash = '#/shopping'; });
    await sleep(200);
    await page.evaluate(() => { location.hash = '#/family'; });
    await sleep(2100); // 取樣點：買菜頁早就回來了，家人頁還沒到
    const mid = await snapshot(page);
    ok(mid.which !== 'family', '（前提）此刻家人頁確實還沒載完 —— 真的有空窗，這一節才量得到東西');
    ok(mid.which !== 'shopping', `空窗期間畫面沒有變成買菜頁（實際是「${mid.which}」）`);
    ok(!mid.title.includes('買菜'), `頂列標題也沒有變成買菜（實際是「${mid.title}」）`);
    // 對照組：不是「乾脆整個空白」—— 等下去要等得到使用者真正選的那一頁
    await page.waitForFunction(() => window.__which() === 'family', { timeout: 60000 });
    eq((await snapshot(page)).which, 'family', '再等一下，使用者選的家人頁就出來了');
    await ctx.close(); srv.close();
  }

  section('慢的畫面回來要求轉頁時，不准把使用者從他選的那頁拉走');
  {
    // js/views/recipe.js 查不到食譜 id 時會 navigate('/recipes', { replace: true })，
    // 而那個判斷在 await import 之後 —— 使用者這段時間點去別頁的話，
    // location.replace 會硬把人扯回食譜清單。跟「按了就跳到別頁」是同一件事。
    const { srv, port } = await delayServer((u) => (u.startsWith('/js/views/recipe.js') ? 1500 : 0));
    const { ctx, page } = await openApp(browser, port);
    await page.evaluate(() => { location.hash = '#/recipes/沒有這一道'; });
    await sleep(200);
    await page.evaluate(() => { location.hash = '#/family'; });
    await sleep(3000);
    const after = await snapshot(page);
    eq(after.hash, '#/family', '網址還在使用者選的那一頁 —— 沒有被 location.replace 扯走');
    eq(after.which, 'family', '畫面也是那一頁');
    await ctx.close(); srv.close();
  }

  section('對照組：停著不動的時候，查不到的食譜還是要退回清單');
  {
    // 上面那條不是「乾脆不轉頁」。使用者沒有換頁時，查不到的 id 還是要把他帶回食譜頁，
    // 不能卡在空白畫面。
    const { srv, port } = await delayServer(() => 0);
    const { ctx, page } = await openApp(browser, port);
    await page.evaluate(() => { location.hash = '#/recipes/沒有這一道'; });
    await sleep(1800);
    const after = await snapshot(page);
    eq(after.hash, '#/recipes', '退回食譜清單了');
    eq(after.which, 'recipes', '畫面也是食譜清單');
    await ctx.close(); srv.close();
  }

  section('慢歸慢，最後一定要停在對的那一頁');
  {
    // 對照組：修法不是「乾脆什麼都不畫」—— 慢的那一頁自己被選中時，還是要畫出來。
    const { srv, port } = await delayServer((u) => (u.startsWith('/js/views/family.js') ? 1200 : 0));
    const { ctx, page } = await openApp(browser, port);
    await page.evaluate(() => { location.hash = '#/shopping'; });
    await sleep(300);
    await page.evaluate(() => { location.hash = '#/family'; });
    await page.waitForFunction(() => window.__which() === 'family', { timeout: 60000 });
    const after = await snapshot(page);
    eq(after.which, 'family', '慢的畫面最後還是畫出來了');
    eq(after.hash, '#/family', '網址也對得上');
    await ctx.close(); srv.close();
  }

  section('連續換頁：中間那幾頁不准留在畫面上');
  {
    // 使用者在分頁列上連按四下。每一頁都慢 700 毫秒，最後只能停在最後那一頁。
    const { srv, port } = await delayServer((u) => (u.startsWith('/js/views/') ? 700 : 0));
    const { ctx, page } = await openApp(browser, port);
    const seen = [];
    for (const hash of ['#/shopping', '#/recipes', '#/family', '#/today']) {
      await page.evaluate((x) => { location.hash = x; }, hash);
      await sleep(150);
      seen.push(await page.evaluate(() => window.__which()));
    }
    await sleep(4000);
    const after = await snapshot(page);
    eq(after.which, 'today', `連按四下之後停在最後選的那一頁（中途看到的是 ${seen.join('→')}）`);
    eq(after.hash, '#/today', '網址也對得上');
    note(`中途取樣 4 次：${seen.join(' → ')}`);
    await ctx.close(); srv.close();
  }
} finally {
  await browser.close();
}

done('racetest');

// 版本混搭（npm run versionmixtest）。沿用 StockDiary 的作法，但守的是 MealMate 自己的行為。
//
// 為什麼這種混搭在真實環境出得來：
//   GitHub Pages 對每一個檔案送 Cache-Control: max-age=600（StockDiary 實測過），而且沒有
//   revalidate。瀏覽器的 HTTP 快取是**逐檔**計時的，所以在 Service Worker 還沒接手的那段時間
//   （第一次載入、SW 被系統回收、剛部署完），一個十分鐘前快取的 app.js 完全可能配上一個剛抓的 view。
//   StockDiary 的使用者就是這樣遇到「點『管理定期定額計畫』直接跳回主頁」。
//
// MealMate 從 M0 就決定**不靜默跳首頁**：不認得的路由走 setNotFound → 「這個畫面在你目前的版本裡
// 還沒有」＋「更新到最新版」。這支測試把混搭真的做出來，證明那條路真的會走到 ——
// 用 M3 的 app.js（沒有 /today 路由）配上 M4 的本週頁（有「一起煮」按鈕）。

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { ok, eq, section, done, everyOf } from './tap.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

// M3 收尾那一版：有「買菜」但還沒有「今天一起煮」
const OLD_REV = execFileSync('git', ['rev-list', '-1', '--grep=M3 買菜', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();

function fromRev(rev, rel) {
  try { return execFileSync('git', ['show', `${rev}:${rel}`], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 }); }
  catch { return null; }
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
};

function makeServer(state) {
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let rel = decodeURIComponent(url.pathname).replace(/^\//, '');
    if (rel === '' || rel.endsWith('/')) rel += 'index.html';
    let body = null;
    if (state.oldFiles.has(rel)) body = fromRev(OLD_REV, rel);
    else {
      const full = path.resolve(ROOT, rel);
      if (full.startsWith(ROOT) && fs.existsSync(full)) body = fs.readFileSync(full);
    }
    if (!body) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(rel).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  });
}

section('前提：舊版確實沒有那條路由，新版有');
ok(OLD_REV.length >= 7, `舊版 commit ${OLD_REV.slice(0, 7)}（M3 收尾）`);
const oldApp = fromRev(OLD_REV, 'js/app.js')?.toString('utf8') ?? '';
const oldWeek = fromRev(OLD_REV, 'js/views/week.js')?.toString('utf8') ?? '';
const newApp = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
const newWeek = fs.readFileSync(path.join(ROOT, 'js/views/week.js'), 'utf8');
ok(oldApp.length > 500 && oldWeek.length > 500, '拿得到舊版的 app.js 與本週頁');
ok(!oldApp.includes("route('/today'"), '舊版 app.js 沒有 /today 路由');
ok(newApp.includes("route('/today'"), '新版 app.js 有 /today 路由');
ok(!oldWeek.includes('cookToday'), '舊版本週頁沒有「一起煮」按鈕');
ok(newWeek.includes('cookToday'), '新版本週頁有「一起煮」按鈕');

const state = { oldFiles: new Set() };
const srv = makeServer(state);
await new Promise((r) => srv.listen(0, r));
const PORT = srv.address().port;
const BASE = `http://localhost:${PORT}/`;
let srvClosed = false;
const closeServer = () => { if (!srvClosed) { srvClosed = true; srv.close(); } };

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });

async function freshPage() {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  page.setDefaultTimeout(60000);
  page.setDefaultNavigationTimeout(60000);
  await page.setViewport({ width: 390, height: 844 });
  const logs = [];
  page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
  return { ctx, page, logs };
}

/** 開起來、按掉首次說明、產生本週菜單（「一起煮」按鈕要有菜才會出現）。 */
async function bootWithPlan(page) {
  await page.goto(BASE, { waitUntil: 'networkidle0' });
  await page.waitForSelector('[data-action="acceptDisclaimer"]');
  await page.click('[data-action="acceptDisclaimer"]');
  await page.waitForSelector('#view .card');
  await page.waitForSelector('[data-action="generate"]', { timeout: 60000 });
  await page.$eval('[data-action="generate"]', (el) => el.click());
  await page.waitForSelector('[data-card="weekHead"]', { timeout: 60000 });
}

/** 按下「一起煮」，回報按完之後的狀態。 */
async function clickCookToday(page) {
  const found = await page.evaluate(() => {
    const el = document.querySelector('#view [data-action="cookToday"]');
    if (!el) return null;
    el.click();
    return { href: el.getAttribute('href') };
  });
  if (!found) return { clicked: false };
  await new Promise((r) => setTimeout(r, 1500));
  return {
    clicked: true,
    ...(await page.evaluate(() => ({
      hash: decodeURIComponent(location.hash),
      title: document.getElementById('topTitle')?.textContent ?? '',
      timeline: !!document.querySelector('#view [data-card="timeline"], #view [data-card="todayEmpty"]'),
      mismatchCard: !!document.querySelector('#view [data-card="versionMismatch"]'),
      updateButton: [...document.querySelectorAll('#view button')].some((b) => b.textContent.includes('更新到最新版')),
      tabs: document.querySelectorAll('#tabbar .tab').length,
    }))),
  };
}

try {
  section('對照組：整組都是新版 —— 按下去就進得去');
  state.oldFiles = new Set();
  {
    const { ctx, page } = await freshPage();
    await bootWithPlan(page);
    const r = await clickCookToday(page);
    ok(r.clicked, '本週頁上有「一起煮」按鈕');
    ok(r.hash.startsWith('#/today'), `進到今日煮（${r.hash}）`);
    ok(r.timeline, '而且真的畫出時間線');
    eq(r.mismatchCard, false, '不需要出現「需要更新」的說明');
    await ctx.close();
  }

  section('混搭：舊版 app.js ＋ 新版本週頁');
  // 畫面上有按鈕（新版 view），但路由表裡沒有那條路（舊版 app.js）。
  state.oldFiles = new Set(['js/app.js']);
  {
    const { ctx, page, logs } = await freshPage();
    await bootWithPlan(page);
    const r = await clickCookToday(page);
    ok(r.clicked, '按鈕還是在（因為 view 是新版）');
    eq(r.timeline, false, '**進不去** —— 舊的路由表沒有這條路');
    eq(r.mismatchCard, true, '但畫面上有說明區塊，不是靜默跳回首頁');
    eq(r.updateButton, true, '而且有「更新到最新版」的按鈕');
    ok(r.hash.startsWith('#/today'), `網址留在原地（${r.hash}），更新後重載就接得上`);
    ok(r.tabs >= 3, `底部分頁還在（${r.tabs} 個），沒有把使用者困住`);
    eq(logs.filter((l) => /pageerror/.test(l)), [], '沒有未攔截的例外');
    await ctx.close();
  }

  section('新版多出來的每一條路由，混搭時都要有說明');
  const routeOf = (src) => [...src.matchAll(/route\('([^']+)'/g)].map((m) => m[1]);
  const onlyNew = routeOf(newApp).filter((r) => !routeOf(oldApp).includes(r));
  ok(onlyNew.length > 0, `新版多出來的路由：${onlyNew.join('、')}`);
  state.oldFiles = new Set(['js/app.js']);
  for (const pattern of onlyNew) {
    const { ctx, page } = await freshPage();
    await page.goto(`${BASE}#${pattern}`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('#view .card');
    await new Promise((r) => setTimeout(r, 800));
    const r = await page.evaluate(() => ({
      hash: decodeURIComponent(location.hash),
      mismatch: !!document.querySelector('#view [data-card="versionMismatch"]'),
    }));
    ok(r.mismatch, `${pattern} 在舊版下顯示「這個畫面在你目前的版本裡還沒有」`);
    ok(!/^#\/$/.test(r.hash), `${pattern} 沒有被靜默丟回首頁（網址還是 ${r.hash}）`);
    await ctx.close();
  }

  section('Service Worker 換版是整組的，不會半路混檔');
  // 讀程式碼不算實證：先讓舊版 SW 完整裝好並接手，再把伺服器換成新版，看畫面與路由一不一致。
  state.oldFiles = new Set(['js/app.js', 'js/views/week.js', 'js/views/today.js', 'sw.js', 'index.html']);
  {
    const { ctx, page } = await freshPage();
    // 先在舊版底下把資料準備好（同意說明、產生菜單）。放到換版之後才做的話，
    // 那一步會跟自動換版的重載搶同一個瞬間，偶發卡在「還沒畫出菜單」（實際踩過）。
    await bootWithPlan(page);
    const controlled = await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      for (let i = 0; i < 50 && !navigator.serviceWorker.controller; i += 1) await new Promise((r) => setTimeout(r, 100));
      return !!navigator.serviceWorker.controller;
    });
    ok(controlled, 'SW 已經接手這個頁面');
    const before = await page.evaluate(async () => (await import('./js/router.js')).routePatterns());
    ok(!before.includes('/today'), `舊版 SW 之下看到的路由沒有 /today（${before.length} 條）`);
    eq(await page.$('[data-action="cookToday"]'), null, '（前提）舊版的本週頁上沒有「一起煮」按鈕');

    // 伺服器整個換成新版（模擬部署），重載 —— 舊的 SW 還在管這個頁面
    state.oldFiles = new Set();
    await page.reload({ waitUntil: 'networkidle0' });
    // 剛開啟、還沒動過任何東西時 App 會自動換版並重載一次（app.js 的 canAutoUpdate），先等它做完。
    // 等完再重新導覽一次：不這樣做的話，下面的點擊可能剛好撞上那次自動重載，
    // 畫面還沒畫完就被判定成「沒有按鈕」（這一節第一版就是這樣偶發紅的）。
    await new Promise((r) => setTimeout(r, 6000));
    await page.goto(BASE, { waitUntil: 'networkidle0' });
    // 菜單早就存在 IndexedDB 裡了，本週頁一畫出來就有 weekHead —— 不必再點「產生」，
    // 也就不會跟自動換版的重載搶同一個瞬間。
    // 關鍵不變式，也是使用者真正感受得到的那一條：**畫面上有那顆按鈕，按下去就一定要進得去。**
    await page.waitForSelector('[data-card="weekHead"]', { timeout: 60000 });
    await new Promise((r) => setTimeout(r, 500));
    const r = await clickCookToday(page);
    if (r.clicked) {
      ok(r.timeline, '畫面上有按鈕，按下去就進得去 —— 沒有混搭');
      eq(r.mismatchCard, false, '不需要出現「需要更新」的說明');
    } else {
      const routes = await page.evaluate(async () => (await import('./js/router.js')).routePatterns());
      ok(!routes.includes('/today'), '沒有按鈕的話，路由表裡也不該有 /today —— 兩者一致');
    }
    await ctx.close();
  }

  section('換版提示列：使用者動過畫面之後，不可以在他手上把畫面抽掉');
  // StockDiary 的實測結論：一開 App 就自動換版是對的，但**使用者已經在操作**時自動重載
  // 會把他正在看的東西抽掉，所以改成跳一條「有新版本／點一下更新」。這一節把那個處境做出來：
  // 裝上舊版 SW → 使用者碰了畫面 → 部署新版 → 應該出現提示列，而不是直接重載。
  state.oldFiles = new Set(['sw.js']);
  {
    const { ctx, page } = await freshPage();
    await page.goto(BASE, { waitUntil: 'networkidle0' });
    await page.waitForSelector('#view .card');
    const controlled = await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      for (let i = 0; i < 60 && !navigator.serviceWorker.controller; i += 1) await new Promise((r) => setTimeout(r, 100));
      return !!navigator.serviceWorker.controller;
    });
    ok(controlled, '（前提）舊版 SW 已經接手');
    // 使用者動了畫面 —— 從這一刻起不准自動重載（app.js 的 canAutoUpdate）
    await page.evaluate(() => { window.dispatchEvent(new PointerEvent('pointerdown')); });
    await new Promise((r) => setTimeout(r, 200));

    state.oldFiles = new Set(); // 部署新版
    await page.evaluate(async () => { const reg = await navigator.serviceWorker.getRegistration(); await reg.update(); });
    await page.waitForSelector('#updateBar', { timeout: 60000 });
    const bar = await page.evaluate(() => {
      const b = document.getElementById('updateBar');
      const btns = [...b.querySelectorAll('button')];
      return {
        text: b.textContent.replace(/\s+/g, ' ').trim(),
        labels: btns.map((x) => x.textContent.trim()),
        aria: btns.map((x) => x.getAttribute('aria-label') ?? ''),
        heights: btns.map((x) => Math.round(x.getBoundingClientRect().height)),
        cards: document.querySelectorAll('#view .card').length,
      };
    });
    ok(bar.text.includes('有新版本'), `提示列講出有新版本：「${bar.text}」`);
    ok(bar.labels.includes('點一下更新'), `有「點一下更新」可以按（${bar.labels.join('、')}）`);
    ok(bar.aria.includes('稍後再說'), `也可以先不要更新（${bar.aria.filter(Boolean).join('、')}）`);
    everyOf(bar.heights, (hh) => hh >= 44, `兩顆按鈕都按得到（${bar.heights.join('、')}px）`);
    ok(bar.cards > 0, `**畫面沒有被抽掉**（${bar.cards} 張卡片還在）`);

    // 按下去要真的換版並重載（重載會把執行環境換掉，所以用導覽事件等，不要在中間插 evaluate）
    await page.evaluate(() => { window.__beforeReload = true; });
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60000 }),
      page.click('#updateBar .update-go'),
    ]);
    await page.waitForSelector('#view .card', { timeout: 60000 });
    eq(await page.evaluate(() => window.__beforeReload === undefined), true, '按下「點一下更新」之後真的重載了');
    eq(await page.$('#updateBar'), null, '重載之後提示列不見了');
    await ctx.close();
  }

  section('離線也要開得起來（版本參數不能把 SW 快取繞過去）');
  // 網址上的 ?v=<版本> 是給瀏覽器 HTTP 快取用的鍵。SW 的快取如果照字面比對，
  // 帶參數的請求就永遠命中不了預快取的檔案 —— 線上看不出來（會走網路），**離線就整個打不開**。
  state.oldFiles = new Set();
  {
    const { ctx, page } = await freshPage();
    await page.goto(BASE, { waitUntil: 'networkidle0' });
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      for (let i = 0; i < 50 && !navigator.serviceWorker.controller; i += 1) await new Promise((r) => setTimeout(r, 100));
    });
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('#view .card');
    ok(await page.evaluate(() => !!navigator.serviceWorker.controller), 'SW 正在管這個頁面');
    if (await page.$('[data-action="acceptDisclaimer"]')) {
      await page.click('[data-action="acceptDisclaimer"]');
      await page.waitForSelector('#view .card');
    }

    // 拔網路：瀏覽器端與伺服器端都要拔 —— page.setOfflineMode 管不到 SW 自己發的 fetch
    await page.setOfflineMode(true);
    closeServer();
    await new Promise((r) => setTimeout(r, 300));
    const netDead = await page.evaluate(async (base) => {
      try { await fetch(`${base}no-such-file-${Date.now()}`); return false; } catch { return true; }
    }, BASE);
    ok(netDead, '（對照）網路真的斷了 —— 底下的離線斷言才算數');

    await page.reload({ waitUntil: 'domcontentloaded' });
    const offline = await page.evaluate(async () => {
      for (let i = 0; i < 100; i += 1) {
        if (document.querySelector('#view .card')) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      return {
        cards: document.querySelectorAll('#view .card').length,
        tabs: document.querySelectorAll('#tabbar .tab').length,
        text: document.querySelector('#view')?.textContent.replace(/\s+/g, ' ').slice(0, 60) ?? '',
      };
    });
    ok(offline.cards > 0, `離線重載之後畫面還在（${offline.cards} 張卡片）：「${offline.text}」`);
    ok(offline.tabs >= 3, `底部分頁也在（${offline.tabs} 個）`);

    // 離線時動態 import 的 view 也要載得進來（它們帶版本參數）
    await page.evaluate(() => { location.hash = '#/today'; });
    const offlineRoute = await page.evaluate(async () => {
      for (let i = 0; i < 100; i += 1) {
        const t = document.getElementById('topTitle')?.textContent;
        if (t && t !== '本週菜單' && t !== 'MealMate') break;
        await new Promise((r) => setTimeout(r, 100));
      }
      return {
        title: document.getElementById('topTitle')?.textContent,
        mismatch: !!document.querySelector('#view [data-card="versionMismatch"]'),
        cards: document.querySelectorAll('#view .card').length,
      };
    });
    eq(offlineRoute.title, '今天一起煮', '離線時 M4 新增的 view 也載得進來（帶版本參數也命中快取）');
    eq(offlineRoute.mismatch, false, '沒有誤判成版本不一致');
    ok(offlineRoute.cards > 0, `而且畫得出東西（${offlineRoute.cards} 張卡片）`);
    await page.setOfflineMode(false);
    await ctx.close();
  }
} finally {
  await browser.close();
  closeServer();
}

done('versionmixtest');

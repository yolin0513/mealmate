// 加到主畫面（PWA）能驗的部分（npm run pwatest）。
//
// **這一支不能取代真機實測。** iPhone 上「加到主畫面」之後的行為（獨立視窗、狀態列顏色、
// 安全區留白、Safari 與主畫面 App 的儲存空間是分開的）只有真的裝一次才知道。
// 這裡驗的是「裝得起來的前提」與「裝起來之後畫面不會壞」的那些可自動化的部分：
//   · manifest 的必填欄位、圖示檔真的存在而且尺寸相符
//   · index.html 的 iOS meta 與 manifest 不打架
//   · Service Worker 有把 manifest 與圖示一起預快取（離線也拿得到）
//   · 用 iPhone 的尺寸與 display-mode: standalone 模擬跑一遍四個分頁，不爆版、不橫向捲動
//   · 使用者資料只放 IndexedDB，而且畫面上有講「主畫面 App 與 Safari 不共用資料」

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { ok, eq, section, done, everyOf, noneOf, note } from './tap.mjs';
import { listen } from './serve.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const manifest = JSON.parse(read('manifest.webmanifest'));
const html = read('index.html');
const sw = read('sw.js');
const css = read('css/style.css');

section('manifest：裝得起來的必填欄位');
eq(manifest.display, 'standalone', '獨立視窗（不是瀏覽器分頁）');
eq(manifest.start_url, './', '起始網址是相對的（GitHub Pages 有子路徑，寫絕對路徑會裝錯地方）');
eq(manifest.scope, './', 'scope 也是相對的');
ok(manifest.name && manifest.name.length >= 4, `名稱：${manifest.name}`);
ok(manifest.short_name && manifest.short_name.length <= 12, `主畫面短名稱：${manifest.short_name}（≤ 12 字才不會被截斷）`);
eq(manifest.lang, 'zh-Hant', '語言標成繁體中文');
ok(/估計值|僅供參考/.test(manifest.description ?? ''), '連 manifest 的說明都寫了「估計值僅供參考」');

section('圖示：檔案真的在，而且尺寸跟宣告一致');
const pngSize = (rel) => {
  const b = fs.readFileSync(path.join(ROOT, rel));
  const isPng = b.slice(1, 4).toString('latin1') === 'PNG';
  return { isPng, w: b.readUInt32BE(16), h: b.readUInt32BE(20), bytes: b.length };
};
const icons = manifest.icons.map((i) => ({ ...i, rel: i.src.replace(/^\.\//, ''), ...(fs.existsSync(path.join(ROOT, i.src.replace(/^\.\//, ''))) ? pngSize(i.src.replace(/^\.\//, '')) : { missing: true }) }));
ok(icons.length >= 2, `（母體）manifest 列了 ${icons.length} 個圖示`);
noneOf(icons, (i) => i.missing, '每個圖示檔案都在');
everyOf(icons, (i) => i.isPng, '每個都是真的 PNG');
everyOf(icons, (i) => `${i.w}x${i.h}` === i.sizes, `宣告的尺寸跟檔案一致（${icons.map((i) => `${i.rel.split('/').pop()} ${i.w}x${i.h}`).join('、')}）`);
ok(icons.some((i) => i.purpose === 'maskable'), '有 maskable 圖示（Android 圓形遮罩才不會被切到）');
ok(icons.some((i) => i.sizes === '512x512'), '有 512 的大圖');

section('index.html 的 iOS 設定跟 manifest 不打架');
ok(/<link rel="manifest" href="\.\/manifest\.webmanifest"/.test(html), '有掛 manifest');
ok(/apple-mobile-web-app-capable" content="yes"/.test(html), 'iOS 加到主畫面後用獨立視窗');
ok(/apple-mobile-web-app-title" content="MealMate"/.test(html), 'iOS 主畫面名稱寫死成 MealMate');
const appleIcon = /apple-touch-icon" href="([^"]+)"/.exec(html)?.[1];
ok(appleIcon && fs.existsSync(path.join(ROOT, appleIcon.replace(/^\.\//, ''))), `apple-touch-icon 指到存在的檔案：${appleIcon}`);
const themeMeta = /name="theme-color" content="([^"]+)"/.exec(html)?.[1];
eq(themeMeta, manifest.theme_color, 'index.html 的 theme-color 跟 manifest 一致');
ok(/viewport-fit=cover/.test(html), 'viewport 有 viewport-fit=cover（瀏海機才吃得到安全區）');
ok(/env\(safe-area-inset-bottom/.test(css) && /env\(safe-area-inset-top/.test(css), 'CSS 有留上下安全區');
note('安全區實際留多少、狀態列顏色對不對，只有真機看得到 —— 這裡只能確認有寫。');

section('Service Worker 有把安裝需要的東西一起快取');
for (const asset of ['./manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png']) {
  ok(sw.includes(`'${asset}'`), `SHELL 預快取包含 ${asset}`);
}
ok(sw.includes("'./icons/icon-maskable-512.png'"), 'SHELL 預快取包含 maskable 圖示（manifest 列了就要快取得到）');

// ---------------------------------------------------------------------------
const { srv, port } = await listen(0);
// 用 --app 開：那是**真的**獨立視窗（display-mode: standalone），不是模擬。
// puppeteer 的 emulateMediaFeatures 不收 display-mode，CDP 的 setEmulatedMedia 在 Chrome 131 也吃不到。
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', `--app=http://localhost:${port}/`] });
try {
  const page = (await browser.pages())[0];
  page.setDefaultTimeout(60000);
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e.message)));
  // iPhone 14 的尺寸與像素密度，加上 iOS 的 UA 與「已經加到主畫面」的顯示模式
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1');
  await page.goto(`http://localhost:${port}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-action="acceptDisclaimer"]');
  await page.click('[data-action="acceptDisclaimer"]');
  await page.waitForSelector('#view .card');

  section('用 iPhone 的尺寸、以「主畫面 App」的顯示模式跑一遍');
  eq(await page.evaluate(() => window.matchMedia('(display-mode: standalone)').matches), true, '（前提）瀏覽器確實回報自己是獨立視窗模式');
  await page.evaluate(async () => {
    const store = await import('./js/store.js');
    const prefs = await import('./js/prefs.js');
    const { newMember } = await import('./js/members.js');
    const { generateWeek, mondayOf, isoDate } = await import('./js/planner.js');
    await store.saveMember({ ...newMember(), name: '阿嬤', ageGroup: 'senior', diet: 'lactoOvo', conditions: ['diabetes'] });
    await prefs.set('shoppingDays', [1, 4]);
    const { plan, diagnostics } = generateWeek({
      recipes: store.allRecipes(), members: store.members(), idx: store.foodsIndex(), units: store.units(),
      rules: { noRepeatDays: prefs.get('noRepeatDays'), avoid: prefs.get('avoid') },
      favorites: [], history: [], mondayIso: mondayOf(isoDate(new Date())), seed: 'pwa', shoppingDays: [1, 4], haveFoods: new Set(),
    });
    await store.savePlan({ ...plan, diagnostics });
  });
  const pages = [];
  for (const [name, hash, wait] of [['本週', '#/', '[data-card="weekHead"]'], ['買菜', '#/shopping', '[data-card="shopRange"]'], ['食譜', '#/recipes', '[data-list="recipes"] a.row'], ['家人', '#/family', '[data-card="about"]']]) {
    // 先繞一頁再過去：設成同一個 hash 不會觸發 hashchange，畫面會停在剛才那一版（本週頁的空狀態）
    await page.evaluate(() => { location.hash = '#/recipes/new'; });
    await new Promise((r) => setTimeout(r, 250));
    await page.evaluate((h) => { location.hash = h; }, hash);
    await page.waitForSelector(wait, { timeout: 60000 });
    await new Promise((r) => setTimeout(r, 400));
    pages.push({ name, ...(await page.evaluate(() => {
      const doc = document.documentElement;
      const tab = document.getElementById('tabbar').getBoundingClientRect();
      const last = [...document.querySelectorAll('#view .card')].pop().getBoundingClientRect();
      return {
        scrollW: doc.scrollWidth, clientW: doc.clientWidth,
        cards: document.querySelectorAll('#view .card').length,
        appPadBottom: parseFloat(getComputedStyle(document.getElementById('app')).paddingBottom),
        tabH: Math.round(tab.height),
        lastCardBottom: Math.round(last.bottom + window.scrollY),
        docH: Math.round(doc.scrollHeight),
      };
    })) });
  }
  ok(pages.length === 4, `（母體）四個分頁都走過：${pages.map((p) => p.name).join('、')}`);
  everyOf(pages, (p) => p.cards > 0, '每一頁都畫得出卡片');
  noneOf(pages, (p) => p.scrollW > p.clientW + 1, 'iPhone 尺寸下沒有橫向捲動');
  everyOf(pages, (p) => p.appPadBottom >= p.tabH, `內容區底部留白 ≥ 分頁列高度（${pages[0].appPadBottom}px ≥ ${pages[0].tabH}px），最後一張卡片不會被分頁列蓋住`);
  everyOf(pages, (p) => p.docH >= p.lastCardBottom, '整頁捲得到最後一張卡片的底部');

  section('資料只在這台裝置：IndexedDB，而且畫面上有講清楚');
  const storage = await page.evaluate(async () => {
    const dbs = (await indexedDB.databases?.()) ?? [];
    return { dbs: dbs.map((d) => d.name), localStorageKeys: Object.keys(localStorage), sessionKeys: Object.keys(sessionStorage) };
  });
  ok(storage.dbs.includes('mealmate'), `使用者資料在 IndexedDB（${storage.dbs.join('、')}）`);
  eq(storage.localStorageKeys, [], 'localStorage 是空的 —— 沒有把使用者資料放在那裡');
  await page.evaluate(() => { location.hash = '#/family'; });
  await page.waitForSelector('[data-card="backup"]');
  const backup = await page.$eval('[data-card="backup"]', (el) => el.textContent.replace(/\s+/g, ' '));
  everyOf(['主畫面', 'Safari', '不共用'], (t) => backup.includes(t), `備份卡講明主畫面 App 與 Safari 的資料是分開的：「${/iPhone[^。]*。/.exec(backup)?.[0] ?? backup.slice(0, 60)}」`);
  ok(/匯出|備份檔/.test(backup), '而且講得出該怎麼辦（匯出備份檔）');

  eq(pageErrors, [], '整段沒有未攔截的例外');
} finally {
  await browser.close();
  srv.close();
}

note('真機還沒測的：實際「加到主畫面」的安裝流程、獨立視窗的狀態列顏色、瀏海機的安全區留白、iOS 清除 Safari 資料時主畫面 App 的資料會不會一起消失。這四件事要在 iPhone 上做一次。');
done('pwatest');

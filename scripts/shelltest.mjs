// PWA 殼的稽核（npm run shelltest）—— 沿用 StockDiary 的 shelltest。
//
//   A. 靜態稽核：從 js/app.js 走完整個 import 圖，每一個模組都必須在 sw.js 的 SHELL_ASSETS 裡；
//      版本號三處一致；沒有人 import app.js；沒有一頁自己寫 #view；沒有跳脫壞掉的 regex；
//      沒有任何非同源 fetch；CSP 的 connect-src 只有 'self'。
//   B. 真的用瀏覽器開起來：h() 不接受 html: prop、網址白名單、每條路由都畫得出東西、
//      不認得的網址講清楚不靜默跳首頁、關於卡片有版本、首頁有健康說明。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { ok, eq, section, done, noneOf, everyOf, detects } from './tap.mjs';
import { listen } from './serve.mjs';
import { stripComments } from './srcscan.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const VERSION_RX = /^mealmate-v\d+\.\d+\.\d+$/;

// ---------- A. 靜態稽核 ----------

export function shellAssetsOf(swSource) {
  const m = /const SHELL_ASSETS = \[([\s\S]*?)\];/.exec(swSource);
  if (!m) throw new Error('sw.js 裡找不到 SHELL_ASSETS');
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

export function importsOf(rawSource) {
  const source = stripComments(rawSource);
  const out = new Set();
  const patterns = [
    /\bimport\s+[^'"]*?from\s+'([^']+)'/g,
    /\bimport\s+'([^']+)'/g,
    /\bimport\(\s*'([^']+)'\s*\)/g,
    /\bimport\(\s*`([^`$]+)/g,
  ];
  for (const rx of patterns) {
    for (const m of source.matchAll(rx)) {
      if (m[1].startsWith('.')) out.add(m[1]);
    }
  }
  return [...out];
}

export function reachableModules(entry, readFile) {
  const seen = new Set();
  const missing = [];
  const walk = (rel) => {
    if (seen.has(rel)) return;
    seen.add(rel);
    let src;
    try { src = readFile(rel); } catch { missing.push(rel); return; }
    for (const spec of importsOf(src)) {
      walk(path.posix.normalize(path.posix.join(path.posix.dirname(rel), spec)));
    }
  };
  walk(entry);
  return { modules: [...seen], missing };
}

export function auditShell(modules, shellAssets) {
  const inShell = new Set(shellAssets.map((a) => path.posix.normalize(a.replace(/^\.\//, ''))));
  return modules.filter((m) => !inShell.has(m));
}

const swSource = read('sw.js');
const shellAssets = shellAssetsOf(swSource);
const readModule = (rel) => read(rel);

section('import 稽核器本身');
detects((src) => importsOf(src).includes('./x.js'), {
  shouldHit: ["import { a } from './x.js';", "await import('./x.js');", "import './x.js';"],
  shouldMiss: ["// import { a } from './x.js';", "/* import { a } from './x.js'; */", "import { a } from './y.js';"],
}, 'import 稽核器認得真的 import，也不會把註解裡的當真');

section('沒有跳脫壞掉的 regex');
// 用 shell heredoc 產生程式碼時 `\s` 常變成 `\\s`，在 regex 裡那是「反斜線接 s」——
// 不報錯、測試綠、但那條斷言從此不命中任何東西。判準：regex 字面值裡出現兩個反斜線＋類別字元。
const scanDirs = ['js', 'js/views', 'scripts'];
const sourceFiles = scanDirs.flatMap((d) => fs.readdirSync(path.join(ROOT, d))
  .filter((f) => f.endsWith('.js') || f.endsWith('.mjs'))
  .map((f) => `${d}/${f}`));

function insideString(line, idx) {
  let quote = null;
  for (let k = 0; k < idx; k += 1) {
    const c = line[k];
    if (c === String.fromCharCode(92)) { k += 1; continue; }
    if (quote) { if (c === quote) quote = null; continue; }
    if (c === "'" || c === '"' || c === '`') quote = c;
  }
  return quote !== null;
}

const BS2 = String.fromCharCode(92, 92);
/**
 * regex 本體裡有沒有「被跳脫兩次的類別字元」：逐個跳脫單位往後讀（`\` 跟它後面那個字元算一組），
 * 只有「一組 `\\`」後面緊接 s d w S D W b n 才算。2026-09-24 擷取範圍擴大之後，舊判準 BAD_ESCAPE 在
 * `[^'\\\n]`（跳脫的反斜線＋換行）與 `\\.`（跳脫的反斜線＋任意字元）上誤報——它不管那一對反斜線本來就是一組跳脫。
 * `.` 不在名單裡：`\\.` 是正常寫法，跟「`\.` 被多跳脫一次」在字面上分不出來（已知的盲區）。
 */
export function hasDoubledEscape(body) {
  for (let i = 0; i < body.length; i += 1) {
    if (body[i] !== '\\') continue;
    if (body[i + 1] === '\\' && /[sdwSDWbn]/.test(body[i + 2] ?? '')) return true;
    i += 1;   // 跳過被跳脫的那個字元，下一個單位從它後面開始
  }
  return false;
}
/**
 * 一行裡的 regex 字面值（回 [{ body, index }]）。凡是語法上能開始一個 regex 的位置都算：
 * 前面是 = ( , : ! & | ? { } ; [ > 或 return——除號前面是變數或數字，不會被當成 regex。
 * 2026-09-24 以前只抽「緊接 .test(／.exec( 的」：.replace(、.match(、存進常數的都漏掉（v9 盤點實測四種只抓到一種），
 * 而對照組只驗判準、沒驗擷取——所以擷取本身也要有對照組（下面的 detects）。
 */
export function regexLiteralsOf(line) {
  const out = [];
  for (const m of line.matchAll(/(^|[=(,:!&|?{};[>]|\breturn)\s*\/((?:\\.|\[(?:\\.|[^\]\\\n])*\]|[^/\\\n[])+)\/[gimsuy]*/g)) {
    out.push({ body: m[2], index: m.index + m[0].indexOf('/') });
  }
  return out;
}
const brokenEscapes = [];
for (const rel of sourceFiles) {
  const src = stripComments(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
  src.split(/\r?\n/).forEach((line, i) => {
    for (const { body, index } of regexLiteralsOf(line)) {
      if (!hasDoubledEscape(body)) continue;
      if (insideString(line, index)) continue;
      brokenEscapes.push(`${rel}:${i + 1}  /${body}/`);
    }
  });
}
ok(sourceFiles.length >= 25, `（母體）掃了 ${sourceFiles.length} 個原始碼檔`);
eq(brokenEscapes, [], '沒有任何 regex 的反斜線被跳脫兩次');
const ONE_BS = String.fromCharCode(92);
ok(hasDoubledEscape(BS2 + "s"), "（對照）判準認得出被跳脫兩次的類別字元");
ok(!hasDoubledEscape(ONE_BS + "s"), "（對照）而且不會誤報正常的單反斜線");
// 擷取本身的對照組：四種用法都要抽得出來（2026-09-24 v9 盤點實測出只抓得到 .test( 那一種）
const BROKEN = 'a' + BS2 + 's+b';
const caughtBroken = (line) => regexLiteralsOf(line).some(({ body, index }) => hasDoubledEscape(body) && !insideString(line, index));
detects(caughtBroken, {
  shouldHit: [
    `const ok = /${BROKEN}/.test(x);`,
    `const y = x.replace(/${BROKEN}/g, '');`,
    `const m = x.match(/${BROKEN}/);`,
    `export const R = /${BROKEN}/;`,
    `if (!/${BROKEN}/.test(x)) return;`,
    `return /${BROKEN}/.exec(x);`,
  ],
  shouldMiss: [
    `const half = total / 2 / count;`,
    `const s = '/${BROKEN}/';`,
    `const ok = /a${ONE_BS}s+b/.test(x);`,
    `const url = 'https://example.com/a/b';`,
    // 擴大擷取之後舊判準誤報過的兩種形狀：跳脫的反斜線＋換行、跳脫的反斜線＋任意字元（都是正常寫法）
    `const q = /'(?:[^'${BS2}${ONE_BS}n]|${BS2}.)*'/g;`,
    `const esc = x.replace(/${BS2}./g, '');`,
  ],
}, '（對照）regex 字面值的擷取：.test(、.replace(、.match(、存進常數的都抽得出來；除號、字串裡的、正常的跳脫反斜線不算');

section('SHELL 清單本身');
ok(shellAssets.length > 10, `sw.js 列了 ${shellAssets.length} 個檔案`);
everyOf(shellAssets.filter((a) => a !== './'), (a) => fs.existsSync(path.join(ROOT, a)), 'SHELL 清單裡的檔案都真的存在');
eq([...new Set(shellAssets)].length, shellAssets.length, 'SHELL 清單沒有重複項目');
const version = /const VERSION = '([^']+)'/.exec(swSource)?.[1];
ok(VERSION_RX.test(String(version)), `VERSION 格式正常：${version}`);
everyOf(['./data/foods.json', './data/recipes.json', './data/edu.json', './data/aliases.json', './data/units.json'], (a) => shellAssets.includes(a), '五個資料檔都在 SHELL 裡（離線才開得起來）');

section('import 圖 ⊆ SHELL 清單');
const { modules, missing } = reachableModules('js/app.js', readModule);
eq(missing, [], 'import 到的檔案都存在');
ok(modules.length >= 8, `從 app.js 走得到 ${modules.length} 個模組：${modules.join('、')}`);
eq(auditShell(modules, shellAssets), [], '每一個會被載到的模組都在 SHELL 清單裡');

section('稽核器對照組');
const crippled = shellAssets.filter((a) => a !== './js/views/week.js');
eq(auditShell(modules, crippled), ['js/views/week.js'], '（對照）清單少了 views/week.js 時，稽核器確實會報出來');
detects((asset) => auditShell(modules, shellAssets.filter((a) => a !== asset)).length > 0, {
  shouldHit: ['./js/ui.js', './js/router.js', './js/views/family.js', './js/store.js'],
  shouldMiss: ['./index.html', './css/style.css', './icons/icon-192.png', './data/foods.json'],
}, '稽核器只管 JS 模組，抽掉非模組資產不會誤報');

section('版本號三個地方必須一致');
const appVersion = /export const APP_VERSION = '([^']+)';/.exec(read('js/version.js'))?.[1];
const swVersion = /const VERSION = '([^']+)';/.exec(read('sw.js'))?.[1];
const htmlStamps = [...read('index.html').matchAll(/\?v=([^"'&]+)/g)].map((m) => m[1]);
const sameVersion = (v) => v === appVersion;
ok(VERSION_RX.test(String(appVersion)), `js/version.js 的版本：${appVersion}`);
ok(sameVersion(swVersion), 'sw.js 的 VERSION 與 js/version.js 一致', `sw.js 是 ${swVersion}`);
ok(htmlStamps.length >= 2, `index.html 有 ${htmlStamps.length} 個帶版本的資源網址`);
everyOf(htmlStamps, sameVersion, 'index.html 每一個 ?v= 都是同一個版本');
const [, major, minor, patch] = /^mealmate-v(\d+)\.(\d+)\.(\d+)$/.exec(appVersion);
detects((v) => !sameVersion(v), {
  shouldHit: ['mealmate-v0.0.1', '', `${appVersion} `, ` ${appVersion}`, `${appVersion}.1`, appVersion.slice(0, -1), appVersion.toUpperCase(),
    `mealmate-v${major}.${minor}.${Number(patch) + 1}`, `mealmate-v${major}.${Number(minor) + 1}.${patch}`, `v${major}.${minor}.${patch}`, `mealmate-${major}.${minor}.${patch}`],
  shouldMiss: [appVersion, String(appVersion), `${appVersion}`, appVersion.split('').join(''), `mealmate-v${major}.${minor}.${patch}`],
}, '版本比對是嚴格字串相等');

const stamped = (u) => u.includes('?');
const shouldBeStamped = (u) => {
  const p0 = u.split('?')[0];
  return p0 === './js/app.js' || p0.startsWith('./js/views/');
};
const htmlJsRefs = [...read('index.html').matchAll(/(?:src|href)="(\.\/[^"]+\.js[^"]*)"/g)].map((m) => m[1]);
ok(htmlJsRefs.length >= 5, `index.html 引用了 ${htmlJsRefs.length} 個本地 .js`);
ok(htmlJsRefs.some((u) => u.split('?')[0] === './js/app.js'), 'index.html 確實有載入進入點 app.js');
everyOf(htmlJsRefs, (u) => (shouldBeStamped(u) ? u.endsWith(`?v=${appVersion}`) : !stamped(u)),
  `index.html 每個 .js 引用的網址都跟模組圖實際請求的一致（該帶版本的帶 ?v=${appVersion}，不該帶的不帶）`);
detects((u) => !(shouldBeStamped(u) ? u.endsWith(`?v=${appVersion}`) : !stamped(u)), {
  shouldHit: ['./js/app.js', './js/app.js?v=mealmate-v0.0.1', `./js/router.js?v=${appVersion}`, './js/views/week.js'],
  shouldMiss: [`./js/app.js?v=${appVersion}`, `./js/views/week.js?v=${appVersion}`, './js/router.js', './js/shell.js'],
}, '「網址該不該帶版本」的檢查器有對照組');

section('app.js 的動態 import 都帶版本參數');
const appSrc = read('js/app.js');
const dynamicImports = [...appSrc.matchAll(/await import\(([^)]+)\)/g)].map((m) => m[1].trim());
ok(dynamicImports.length >= 5, `找到 ${dynamicImports.length} 個動態 import`);
everyOf(dynamicImports, (s) => s.includes('${V}'), '每一個動態 import 都帶 ${V} 版本參數');

section('路由表與 view 檔');
const routeDefs = [...appSrc.matchAll(/route\('([^']+)',[\s\S]{0,200}?import\(`([^`$]+)/g)]
  .map((m) => ({ pattern: m[1], view: path.posix.normalize(path.posix.join('js', m[2].replace(/^\.\//, ''))) }));
ok(routeDefs.length >= 4, `註冊了 ${routeDefs.length} 條路由：${routeDefs.map((r) => r.pattern).join('、')}`);
everyOf(routeDefs, (r) => fs.existsSync(path.join(ROOT, r.view)), '每條路由的 view 檔都存在');
const shellSet = new Set(shellAssets.map((a) => path.posix.normalize(a.replace(/^\.\//, ''))));
everyOf(routeDefs, (r) => shellSet.has(r.view), '每條路由的 view 檔都在 SHELL 清單裡');

section('index.html 引用的資源');
const html = read('index.html');
const refs = [...html.matchAll(/(?:href|src)="(\.\/[^"]+)"/g)].map((m) => m[1].split('?')[0]);
ok(refs.length >= 5, `index.html 引用了 ${refs.length} 個本地資源`);
everyOf(refs, (r) => fs.existsSync(path.join(ROOT, r)), 'index.html 引用的檔案都存在');
everyOf(refs, (r) => shellSet.has(path.posix.normalize(r.replace(/^\.\//, ''))), 'index.html 引用的檔案都在 SHELL 清單裡');

section('CSP：沒有外部連線');
const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1] ?? '';
const connectSrc = /connect-src ([^;]+)/.exec(csp)?.[1]?.trim();
eq(connectSrc, "'self'", "connect-src 只有 'self'");
ok(/script-src 'self'(;|$)/.test(csp), "script-src 只有 'self'");
const jsFiles = ['js', 'js/views'].flatMap((d) => fs.readdirSync(path.join(ROOT, d)).filter((f) => f.endsWith('.js')).map((f) => `${d}/${f}`));
const externalFetch = (src) => /\bfetch\(\s*['"`]https?:/.test(stripComments(src)) || /new WebSocket\(/.test(stripComments(src));
noneOf(jsFiles, (f) => externalFetch(read(f)), '沒有任何模組對外部網址 fetch');
detects(externalFetch, {
  shouldHit: ["fetch('https://example.com/x')", 'fetch("http://a.b/")', "await fetch(`https://x.y/${id}`)", 'new WebSocket("wss://x")'],
  shouldMiss: ["fetch('./data/foods.json')", "fetch(`./data/${name}`)", "// fetch('https://commented.out')"],
}, '外部 fetch 的判準有對照組');

export function viewsWritingViewDirectly(source) {
  return /getElementById\(\s*['"]view['"]\s*\)/.test(source) || /mount\(\s*view/.test(source);
}

section('寫入失敗一定有人接得到（結構保證，不靠十幾個呼叫點各自記得）');
{
  // 以前只有一個呼叫點有 catch —— 存不進去時畫面完全不出聲，按鈕彈回去、沒有訊息。
  // 現在每一支寫入都包在 db.js 的 writing() 裡，那是唯一的通報口，所以新增寫入點也漏不掉。
  const dbSrc = stripComments(read('js/db.js'));
  const chunkOf = (name) => {
    const at = dbSrc.indexOf(`export async function ${name}(`);
    if (at < 0) return null;
    const next = dbSrc.indexOf('\nexport ', at + 1);
    return dbSrc.slice(at, next < 0 ? dbSrc.length : next);
  };
  const writes = ['put', 'del', 'clear', 'putAll'].map((n) => ({ n, src: chunkOf(n) }));
  const reads = ['get', 'getAll', 'count', 'getByIndex'].map((n) => ({ n, src: chunkOf(n) }));
  ok(writes.length === 4, `（母體）db.js 的寫入函式共 ${writes.length} 支：${writes.map((w) => w.n).join('、')}`);
  noneOf(writes, (w) => w.src == null, '四支寫入都在 db.js 裡找得到');
  everyOf(writes, (w) => w.src.includes('writing('), '每一支寫入都經過 writing()（會通報，錯誤照樣往上丟）');
  noneOf(reads, (r) => r.src == null, '（對照）四支唯讀的也找得到');
  noneOf(reads, (r) => r.src.includes('writing('), '（對照）get／getAll／count／getByIndex 不通報 —— 上面那條不是因為整個檔案都被包起來');
  ok(/export function onWriteError/.test(dbSrc), 'db.js 對外開了 onWriteError');
  const appSrc = stripComments(read('js/app.js'));
  ok(/db\.onWriteError\(/.test(appSrc), 'app.js 真的訂閱了它 —— 沒人接的話通報等於沒有');
  ok(/addEventListener\('unhandledrejection'/.test(appSrc), 'app.js 另外掛了漏網的安全網（unhandledrejection）');
}

section('連資料庫都開不起來時，啟動要講話，不能停在轉圈圈');
{
  const appSrc = stripComments(read('js/app.js'));
  ok(/await store\.init\(\);/.test(appSrc), '（前提）boot() 會 await store.init()');
  ok(/try \{\s*await store\.init\(\);\s*\} catch/.test(appSrc), '而且包在 try/catch 裡');
  ok(/showStorageBlocked\(e\)/.test(appSrc), '失敗時走 showStorageBlocked()，不是把例外吞掉');
  ok(/card: 'storageBlocked'/.test(appSrc), '那張卡片有自己的 data-card，測得到');
}

section('沒有任何模組 import 進入點 app.js');
const nonEntryModules = ['sw.js', ...jsFiles].filter((f) => f !== 'js/app.js');
noneOf(nonEntryModules, (f) => importsOf(read(f)).some((spec) => spec.split('?')[0].endsWith('/app.js')),
  '沒有任何模組 import app.js（view 要的東西在 js/shell.js）');

section('開機看門狗：整張 module 圖載不到時不可以停在空白');
{
  // Yolin 2026-09-17 回報：按「更新」之後只剩最上面的標題列、下面整片空白，只能把 App 滑掉重開。
  // 那個畫面的意思是 **app.js 整張 module 圖根本沒執行**（連 renderLoading 的轉圈圈都沒有）。
  const guard = read('js/bootguard.js');
  const htmlSrc = read('index.html');
  ok(guard.length > 400, `（母體）看門狗有 ${guard.length} 個字元`);
  ok(!/import|export/.test(stripComments(guard)), '它自己沒有任何 import／export —— 是普通 script，不跟著 module 圖一起死');
  ok(/<script src="\.\/js\/bootguard\.js"><\/script>/.test(htmlSrc), 'index.html 用普通 script 載它（不是 type="module"）');
  const guardAt = htmlSrc.indexOf('js/bootguard.js');
  const appAt = htmlSrc.indexOf('type="module" src="./js/app.js');
  ok(guardAt > 0 && appAt > 0 && guardAt < appAt, '而且排在 app.js 前面');
  ok(swSource.includes("'./js/bootguard.js'"), 'SHELL 預快取包含它（離線也要有）');
  ok(/data-card', 'bootStuck'|'bootStuck'/.test(guard), '它畫出來的卡片有 data-card="bootStuck"，測得到');
  ok(/bootRetry/.test(guard) && /bootHardReset/.test(guard), '而且給了兩條出路：重新載入、清掉快取再載入');
  const appSrc2 = stripComments(read('js/app.js'));
  ok(/document\.documentElement\.dataset\.booted = '1'/.test(appSrc2), 'app.js 開機成功會標 data-booted，看門狗才知道不用出手');
}

section('按「更新」不可以先 unregister（那正是空白畫面的根因）');
{
  // 取消註冊之後這一頁就沒有 Service Worker 了：重載時每個檔案只能走網路，
  // 手機網路一不穩，整張 module 圖就載不齊，而且連快取都沒得退。
  const appSrc3 = stripComments(read('js/app.js'));
  const from = appSrc3.indexOf('function applyNow(');
  const to = appSrc3.indexOf('const ready = (worker)');
  ok(from > 0 && to > from, `（母體）找得到 applyNow 這一段（${to - from} 個字元）`);
  const body = appSrc3.slice(from, to);
  ok(!/unregister/.test(body), 'applyNow 裡沒有 unregister');
  ok(/reload\(\)/.test(body), '（對照）它還是會重載 —— 上面那條不是因為整段被刪掉了');
  ok(/unregister/.test(appSrc3), '（對照）App 其他地方仍留著 unregister（「需要更新」那張卡的強制更新），所以不是全域搜不到');
}

section('「家裡有」已經整個移除（2026-09-17，Yolin 決定）');
{
  // 移掉的理由：它不扣採買量、也沒有跨餐或跨週的追蹤，只是排菜時一個最多 +9 的小加分，
  // 而且只在「重新產生同一週」時才生效 —— 冰箱裡的剩菜用本週頁的「自己指定菜」處理更直接。
  // 這一條盯的是**移乾淨**：半套的移除最難發現（畫面沒有按鈕了，程式裡還留著半條路，
  // 下一個接手的人會以為功能還在）。
  const files = ['js/planner.js', 'js/store.js', 'js/shopping.js', 'js/views/shopping.js', 'js/views/week.js', 'js/views/weekops.js', 'css/style.css'];
  const marks = ['haveFoods', 'row.have', 'usedHave', '你勾了家裡有', 'data-action="have"', "action: 'have'", 'haveBtn'];
  const hits = files.flatMap((f) => { const src = read(f); return marks.filter((m) => src.includes(m)).map((m) => `${f} 還有「${m}」`); });
  ok(files.length === 7 && marks.length === 7, `（母體）掃 ${files.length} 個檔 × ${marks.length} 種殘留形狀`);
  ok(read('js/views/shopping.js').includes('shop-row') && read('js/planner.js').includes('scoreSoft'), '（對照）這幾個檔真的讀進來了，不是空字串');
  eq(hits, [], '產品程式碼裡一個殘留都沒有');
}

section('外部連結不把來源網址送出去');
{
  const eduSrc = read('js/edu.js');
  const rels = [...eduSrc.matchAll(/target: '_blank'[^)]*?rel: '([^']*)'/g)].map((m) => m[1]);
  ok(rels.length >= 1, `（母體）另開視窗的連結有 ${rels.length} 處`);
  everyOf(rels, (r) => r.includes('noopener'), 'rel 有 noopener（新視窗拿不到 window.opener）');
  everyOf(rels, (r) => r.includes('noreferrer'), 'rel 有 noreferrer（連「你從哪個網址點過來」都不告訴對方）');
}

section('沒有任何一頁繞過 render() 直接寫 #view');
const viewFiles = fs.readdirSync(path.join(ROOT, 'js/views')).filter((f) => f.endsWith('.js'));
noneOf(viewFiles, (f) => viewsWritingViewDirectly(read(`js/views/${f}`)), '每一頁都透過 shell.js 的 render() 上畫面');
detects(viewsWritingViewDirectly, {
  shouldHit: ["mount(document.getElementById('view'), x);", 'mount(document.getElementById("view"), x);', 'const el = document.getElementById( "view" );'],
  shouldMiss: ['render([a, b]);', "document.getElementById('modalRoot')", 'mount(bar, ...tabs);'],
}, '這個稽核器抓得到繞過去的寫法，也不會亂抓');

section('toast 不擋點擊');
// toast 淡出的 250 毫秒還在畫面上（opacity 0）；沒有 pointer-events:none 的話，那一下會點到它而不是底下的按鈕。
ok(/#toast\s*\{[^}]*pointer-events:\s*none/.test(read('css/style.css')), '#toast 有 pointer-events: none（實際踩過：存食譜點到正在消失的 toast）');

section('sw.js 不會快取外部請求');
ok(/if \(url\.origin !== self\.location\.origin\) return;/.test(swSource), '跨網域請求直接走網路，不進快取');
ok(/cache: 'reload'/.test(swSource), 'install 時用 cache:reload 預快取，避免存進舊版 JS');

// ---------- B. 瀏覽器 ----------
const { srv, port } = await listen(0);
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(60000);
  page.setDefaultNavigationTimeout(60000);
  await page.setViewport({ width: 390, height: 844 });
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e.message)));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

  await page.goto(`http://localhost:${port}/`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#view .card', { timeout: 60000 });

  section('第一次開：先看說明，按「我知道了」之前哪裡都去不了');
  eq(pageErrors, [], '沒有未攔截的例外');
  eq(consoleErrors.filter((t) => !/favicon|sw\.js/i.test(t)), [], '主控台沒有錯誤');
  eq((await page.$$('#tabbar .tab')).length, 4, '底部四個分頁畫出來了');
  eq(await page.$eval('#topTitle', (el) => el.textContent), '開始之前', '第一次開是說明頁');
  const notice = await page.$eval('#view [data-card="healthNotice"]', (el) => el.textContent.replace(/\s+/g, ' '));
  ok(notice.includes('醫師或營養師'), '有「請以醫師或營養師的指示為準」這一層');
  ok(notice.includes('估'), '有講數字是估算');
  ok(notice.includes('不是醫囑'), '有講留意設定不是醫囑');
  await page.evaluate(() => { location.hash = '#/recipes'; });
  await new Promise((r) => setTimeout(r, 600));
  eq(await page.$eval('#topTitle', (el) => el.textContent), '開始之前', '沒按「我知道了」就想去食譜頁 → 還是說明頁');
  eq(await page.evaluate(() => location.hash), '#/welcome', '網址被導回 #/welcome');
  await page.click('[data-action="acceptDisclaimer"]');
  await page.waitForFunction(() => document.getElementById('topTitle').textContent === '本週菜單', { timeout: 60000 });
  eq(await page.$eval('#topTitle', (el) => el.textContent), '本週菜單', '按了之後進到本週');
  await page.evaluate(() => { location.hash = '#/family'; });
  await page.waitForSelector('#view [data-card="healthNotice"]', { timeout: 60000 });
  ok((await page.$eval('#view [data-card="healthNotice"]', (el) => el.textContent)).includes('醫師或營養師'), '同一段說明常駐在家人分頁');

  section('h() 不接受 html: prop');
  const hRes = await page.evaluate(async () => {
    const { h } = await import('./js/ui.js');
    const payload = '<img src=x onerror="window.__pwned=1"><b>粗體</b>';
    const viaProp = h('div', { html: payload });
    const viaChild = h('div', {}, payload);
    const nested = h('div', {}, h('span', {}, payload));
    document.body.append(viaProp, viaChild, nested);
    await new Promise((r) => setTimeout(r, 50));
    return {
      pwned: !!window.__pwned,
      propChildElements: viaProp.querySelectorAll('*').length,
      propText: viaProp.textContent,
      propHasImg: !!viaProp.querySelector('img'),
      childChildElements: viaChild.querySelectorAll('*').length,
      childText: viaChild.textContent,
      nestedText: nested.textContent,
      imgsInBody: document.querySelectorAll('img').length,
    };
  });
  eq(hRes.pwned, false, 'onerror 沒有被執行');
  eq(hRes.propHasImg, false, 'html: prop 沒有生出 <img> 節點');
  eq(hRes.propChildElements, 0, 'html: prop 沒有生出任何子元素');
  eq(hRes.propText, '', 'html: prop 連文字都沒有進來');
  eq(hRes.childChildElements, 0, '（對照）同一串字當 child 傳，也不會變成元素');
  eq(hRes.childText, '<img src=x onerror="window.__pwned=1"><b>粗體</b>', '（對照）當 child 傳的時候，這串字原封不動顯示出來');
  eq(hRes.nestedText, '<img src=x onerror="window.__pwned=1"><b>粗體</b>', '巢狀節點也是文字');
  eq(hRes.imgsInBody, 0, '整個頁面沒有多出 <img>');

  section('網址屬性白名單');
  const urlRes = await page.evaluate(async () => {
    const { h } = await import('./js/ui.js');
    const mk = (href) => h('a', { href }).getAttribute('href');
    return {
      js: mk('javascript:alert(1)'),
      dataHtml: mk('data:text/html,<script>alert(1)</script>'),
      vb: mk('vbscript:msgbox(1)'),
      https: mk('https://www.hpa.gov.tw/'),
      hash: mk('#/family'),
      rel: mk('./data/foods.json'),
      dataImg: mk('data:image/png;base64,iVBORw0KGgo='),
    };
  });
  noneOf([urlRes.js, urlRes.dataHtml, urlRes.vb], (v) => v != null, '危險的協定全部被丟掉');
  everyOf([urlRes.https, urlRes.hash, urlRes.rel, urlRes.dataImg], (v) => typeof v === 'string' && v.length > 0, '（對照）正常的網址留得下來');

  section('每條路由都畫得出東西');
  // 帶 :id 的路由在這裡拿到的是字面的「:id」，查不到就退回上一層，所以標題是上一層的。
  const EXPECT_TITLE = {
    '/welcome': '開始之前',
    '/': '本週菜單',
    '/today': '今天一起煮',
    '/shopping': '買菜',
    '/recipes': '食譜',
    '/recipes/new': '新增食譜',
    '/recipes/:id/edit': '食譜',
    '/recipes/:id': '食譜',
    '/family': '家人',
    '/family/new': '新增家人',
    '/family/:id': '家人',
  };
  const FALLBACK_HASH = { '/recipes/:id': '#/recipes', '/recipes/:id/edit': '#/recipes', '/family/:id': '#/family' };
  everyOf(routeDefs, (r) => EXPECT_TITLE[r.pattern] != null, '每條路由都列了它應該出現的標題（新增路由時不准漏掉）');
  const titleIs = (want) => page.waitForFunction(
    (t) => document.getElementById('topTitle').textContent === t, { timeout: 60000 }, want);
  const goto = async (hash) => { await page.evaluate((x) => { location.hash = x; }, hash); };

  for (const r of routeDefs) {
    const want = EXPECT_TITLE[r.pattern];
    // 先繞去一個標題不一樣的畫面再過去；不繞的話上一頁剛好同標題時等待會立刻成立，等於沒等。
    const via = want === EXPECT_TITLE['/family'] ? '#/' : '#/family';
    await goto(via);
    await titleIs(EXPECT_TITLE[via === '#/' ? '/' : '/family']);
    await goto('#' + r.pattern);
    let landed = true;
    try { await titleIs(want); } catch { landed = false; }
    const got = await page.evaluate(() => ({
      title: document.getElementById('topTitle').textContent,
      text: document.querySelector('#view').textContent.trim(),
    }));
    ok(landed && got.text.length > 10, `${r.pattern} 真的畫出來了（標題「${want}」，${got.text.length} 字）`, landed ? '' : `標題停在「${got.title}」`);
    // replaceChildren(null) 會印出「null」字；模板字串漏掉 ?? 會印出「undefined」；除以 0 會印「NaN」。實際發生過第一種。
    ok(!/\b(null|undefined|NaN)\b/.test(got.text), `${r.pattern} 畫面上沒有 null／undefined／NaN 這種漏出來的字`, got.text.match(/.{0,30}\b(null|undefined|NaN)\b.{0,30}/)?.[0]);
    if (FALLBACK_HASH[r.pattern]) {
      eq(await page.evaluate(() => location.hash), FALLBACK_HASH[r.pattern], `查不到的 id 會退回 ${FALLBACK_HASH[r.pattern]}`);
    }
  }
  eq(pageErrors, [], '走完所有路由之後仍然沒有例外');

  section('食譜頁真的列出內建食譜、點進去有食材與步驟');
  await goto('#/recipes');
  await titleIs('食譜');
  await page.waitForSelector('#view [data-list="recipes"] a.row', { timeout: 60000 });
  const rowCount = await page.$$eval('#view [data-list="recipes"] a.row', (els) => els.length);
  ok(rowCount >= 30, `清單有 ${rowCount} 道`);
  const firstHref = await page.$eval('#view [data-list="recipes"] a.row', (el) => el.getAttribute('href'));
  await goto(firstHref);
  await page.waitForSelector('#view [data-card="recipeSteps"]', { timeout: 60000 });
  const detail = await page.evaluate(() => ({
    ingredients: document.querySelectorAll('#view [data-card="recipeIngredients"] tbody tr').length,
    steps: document.querySelectorAll('#view [data-card="recipeSteps"] li').length,
    nutritionText: document.querySelector('#view [data-card="recipeNutrition"]')?.textContent ?? '',
  }));
  ok(detail.ingredients >= 1, `食材 ${detail.ingredients} 列`);
  ok(detail.steps >= 3, `步驟 ${detail.steps} 步`);
  const nutriVals = await page.$$eval('#view [data-card="recipeNutrition"] .nutri-value', (els) => els.map((e) => e.textContent.trim()));
  ok(nutriVals.length >= 12, `（母體）營養標示 ${nutriVals.length} 個值`);
  everyOf(nutriVals, (t) => /^估 /.test(t) || t.startsWith('未估算'), '每個營養值都帶「估」字或寫「未估算」');
  ok(detail.nutritionText.includes('估計營養標示'), '營養區塊有標題');

  section('不認得的網址：講清楚原因，不靜默跳回首頁');
  await goto('#/');
  await titleIs('本週菜單');
  await new Promise((r) => setTimeout(r, 300));
  await goto('#/沒有這一頁');
  await page.waitForSelector('#view [data-card="versionMismatch"]', { timeout: 60000 });
  const mismatch = await page.evaluate(() => ({
    hash: location.hash,
    text: document.querySelector('#view').textContent.replace(/\s+/g, ' '),
    hasUpdateButton: [...document.querySelectorAll('#view button')].some((b) => b.textContent.includes('更新到最新版')),
    hasHomeLink: [...document.querySelectorAll('#view a')].some((a) => a.getAttribute('href') === '#/'),
  }));
  ok(mismatch.hasUpdateButton, '有「更新到最新版」的按鈕');
  ok(mismatch.hasHomeLink, '也留了一條回本週的路');
  ok(mismatch.text.includes('沒有這一頁'), '把打不開的那條路徑寫出來');
  ok(mismatch.text.includes(appVersion), `寫出目前執行的版本 ${appVersion}`);
  ok(mismatch.hash !== '#/', `網址留在原地（${mismatch.hash}）`);

  section('關於卡片：版本與資料來源');
  await goto('#/family');
  await page.waitForSelector('#view [data-card="about"]', { timeout: 60000 });
  const about = await page.evaluate(() => ({
    version: document.querySelector('#view [data-field="appVersion"]')?.textContent.trim() ?? '',
    edus: [...document.querySelectorAll('#view [data-card="about"] [data-edu]')].map((e) => e.dataset.edu),
    text: document.querySelector('#view [data-card="about"]').textContent,
  }));
  ok(about.version.includes(appVersion), `關於卡片上寫著目前執行的版本：「${about.version}」`);
  ok(!about.version.includes('mealmate-v0.0.0'), '（對照）不是寫死的假版本號');
  ok(about.edus.includes('fda.tfnd.attribution'), '有標示食藥署資料來源');
  ok(about.edus.includes('hpa.open-data.attribution'), '有標示國健署開放宣告');
  ok(about.text.includes('食品藥物管理署'), '文字裡真的有機關名');

  section('換頁只播報頁名，不是把整頁念一次');
  // 以前 aria-live="polite" 掛在 #view 上：換一次頁、按一顆開關、勾一項買菜清單，
  // 螢幕閱讀器都會把整頁（本週頁 680 個節點）從頭念一遍。改成只播報「現在是哪一頁」。
  {
    const shell = await page.evaluate(() => {
      const ann = document.getElementById('routeAnnounce');
      const r = ann?.getBoundingClientRect();
      return {
        viewLive: document.getElementById('view').getAttribute('aria-live'),
        annExists: !!ann,
        annRole: ann?.getAttribute('role'),
        annLive: ann?.getAttribute('aria-live'),
        annClass: ann?.className,
        annDisplay: ann ? getComputedStyle(ann).display : null,
        annW: r ? Math.round(r.width) : null,
        annH: r ? Math.round(r.height) : null,
      };
    });
    eq(shell.viewLive, null, '#view 身上沒有 aria-live 了（整頁重畫不再整頁播報）');
    ok(shell.annExists, '另外有一塊專門播報的區域 #routeAnnounce');
    eq(shell.annRole, 'status', '它是 role="status"');
    eq(shell.annLive, 'polite', '而且是 polite（不打斷使用者正在聽的東西）');
    eq(shell.annClass, 'sr-only', '畫面上看不到它（.sr-only）');
    ok(shell.annDisplay !== 'none', `但**不是** display:none —— 那樣螢幕閱讀器也讀不到（實際是 ${shell.annDisplay}）`);
    ok(shell.annW <= 1 && shell.annH <= 1, `它不佔版面（${shell.annW}×${shell.annH}px）`);

    await goto('#/recipes');
    await page.waitForSelector('#view [data-list="recipes"]', { timeout: 60000 });
    eq(await page.$eval('#routeAnnounce', (el) => el.textContent), '食譜', '換到食譜頁時播報「食譜」');
    await goto('#/shopping');
    await page.waitForSelector('#view .card', { timeout: 60000 });
    eq(await page.$eval('#routeAnnounce', (el) => el.textContent), '買菜', '換到買菜頁時播報「買菜」');

    // 同一頁重畫不可以再播一次（勾一項、按一顆開關都會重畫）。
    // 播報區塞一個哨兵字串，重畫之後哨兵還在 → 代表沒有再播；換到別頁才會被覆蓋。
    await page.evaluate(() => { document.getElementById('routeAnnounce').textContent = '哨兵'; });
    await page.evaluate(async () => { (await import('./js/router.js')).refresh(); });
    await new Promise((r) => setTimeout(r, 500));
    eq(await page.$eval('#routeAnnounce', (el) => el.textContent), '哨兵', '同一頁重畫沒有再播一次');
    await goto('#/family');
    await page.waitForSelector('#view [data-card="about"]', { timeout: 60000 });
    eq(await page.$eval('#routeAnnounce', (el) => el.textContent), '家人', '（對照）真的換頁時哨兵會被換掉 —— 上面那條不是因為播報壞了');
  }

  section('存不進去的時候要講出來（不是默默失敗）');
  {
    await goto('#/family/new');
    await page.waitForSelector('#view [data-field="name"]', { timeout: 60000 });
    await page.type('[data-field="name"]', '測試家人');
    // 把 IndexedDB 的寫入弄壞（模擬空間不足／無痕模式）。讀取不動，所以其他畫面照樣正常。
    await page.evaluate(() => {
      const proto = IDBObjectStore.prototype;
      proto.__origPut = proto.put;
      proto.put = function put() { throw new DOMException('模擬空間不足', 'QuotaExceededError'); };
    });
    await page.click('[data-action="saveMember"]');
    await page.waitForSelector('.modal-card', { timeout: 20000 });
    const dlg = await page.$eval('.modal-card', (el) => el.textContent.replace(/\s+/g, ' ').trim());
    ok(dlg.includes('沒有存起來'), `跳出對話框講明沒存成功：「${dlg.slice(0, 12)}…」`);
    ok(dlg.includes('關掉 App'), '而且講出後果（關掉 App 就會不見），不是只說「錯誤」');
    ok(/QuotaExceeded/.test(dlg), '附上原始錯誤名稱，遠端支援時問得出來');
    ok(!/^0|^成功|已儲存/.test(dlg), '沒有假裝成功');
    eq(await page.$eval('#toast', (el) => el.hidden), true, '而且沒有同時再冒一個 toast —— 兩道網不會各講一次');
    await page.$$eval('.modal-actions .btn', (els) => els[els.length - 1].click());
    await page.waitForFunction(() => !document.querySelector('.modal-card'), { timeout: 20000 });
    eq(await page.$eval('#topTitle', (el) => el.textContent), '新增家人', '存失敗就留在原地，輸入的東西還在畫面上');
    eq(await page.$eval('[data-field="name"]', (el) => el.value), '測試家人', '（對照）名字沒有被清掉');

    // 對照組：修好之後同一顆按鈕要存得進去、而且不跳對話框。
    await page.evaluate(() => { IDBObjectStore.prototype.put = IDBObjectStore.prototype.__origPut; });
    await page.click('[data-action="saveMember"]');
    await page.waitForFunction(() => document.getElementById('topTitle')?.textContent === '家人', { timeout: 20000 });
    eq(await page.$('.modal-card'), null, '（對照）寫得進去的時候不會跳那個對話框');
    const saved = await page.evaluate(async () => (await import('./js/store.js')).members().map((m) => m.name));
    ok(saved.includes('測試家人'), `（對照）這次真的存進去了：${saved.join('、')}`);
  }

  section('整個 IndexedDB 都不能用時（無痕模式）：講清楚，不要停在「載入中…」');
  {
    // 實測過的壞法：iOS 私密瀏覽、或瀏覽器把這個網站的儲存空間關掉，indexedDB 一碰就丟例外。
    // 修之前畫面會永遠停在轉圈圈的「載入中…」，連底部分頁列都沒有。
    const blind = await browser.newPage();
    blind.setDefaultTimeout(30000);
    try {
      await blind.evaluateOnNewDocument(() => {
        Object.defineProperty(window, 'indexedDB', {
          configurable: true,
          get() { throw new DOMException('模擬無痕模式', 'SecurityError'); },
        });
      });
      await blind.goto(`http://localhost:${port}/`, { waitUntil: 'networkidle0' });
      await blind.waitForSelector('[data-card="storageBlocked"]', { timeout: 30000 });
      const info = await blind.evaluate(() => ({
        text: document.querySelector('[data-card="storageBlocked"]').textContent.replace(/\s+/g, ' ').trim(),
        stillLoading: !!document.querySelector('#view .spinner'),
        retry: !!document.querySelector('[data-action="retryBoot"]'),
      }));
      eq(info.stillLoading, false, '不再停在轉圈圈的「載入中…」');
      ok(info.text.includes('不讓 App 存資料'), `畫面講出發生什麼事：「${info.text.slice(0, 14)}…」`);
      ok(info.text.includes('無痕'), '講出最常見的原因（無痕／私密瀏覽）');
      ok(/SecurityError/.test(info.text), '附上原始錯誤名稱');
      ok(info.retry, '而且給一顆「再試一次」');
    } finally {
      await blind.close();
    }
  }
} finally {
  await browser.close();
  srv.close();
}

done('shelltest');

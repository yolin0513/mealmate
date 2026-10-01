// 突變的依賴範圍與「要不要重跑」的判定（2026-10-01，Yolin：平常只跑受這次改動影響的突變）。
//
// 一條突變的結果由這些東西決定：突變本身（改哪個檔、找什麼、換成什麼、由哪支測試驗）、那支測試執行時讀到的每一個檔、
// 執行器（mutationtest 與它 import 的）。這些全都沒變，重跑的結果一定一樣——可以沿用上次的結果。
// 範圍算錯就會把該跑的跳過，所以**一律從寬**：
//   1. 從測試檔與突變的目標檔出發，照實際的 import 行遞迴（import … from、import '…'、export … from、import('字面')）。
//   2. 一律算進去：data/ 全部、package.json、package-lock.json。
//   3. 範圍裡任何一個檔用到 puppeteer → 瀏覽器測試：看不出畫面載了什麼，docs/ 以外的全部算進去（「整個 App」）。
//   4. App 自己的程式（docs/、scripts/ 以外的檔）裡寫不死的 fetch、import(：App 只會載 App 的檔 → 同樣是「整個 App」。
//   5. 測試與工具（scripts/）裡有讀檔、跑別的程式、fetch、或 import( 接變數，而路徑**不是** path.join(ROOT, '字面', …) 這種寫死的形狀
//      → 判斷不出範圍，**整個 repo** 算進去。
// 「整個 App」不含 docs/ 的前提（兩道都由 doctest 守）：測試用的伺服器 serve.mjs 不送 docs/（受影響 D20），
// 而且 docs/ 底下沒有可以被 import 的程式或 JSON（有的話退回整個 repo，受影響 D10）。
// 帳本檔本身不算（不然每寫一次帳本，全部都變成「改過了」）。
// 純函式：檔案清單與內容由呼叫端給（readSrc），doctest 用記憶體裡的合成 repo 驗每一條規則。

import crypto from 'node:crypto';
import path from 'node:path';

export const LEDGER_FILE = 'scripts/mutation-ledger.json';
export const ALWAYS_PREFIXES = ['data/'];
export const ALWAYS_FILES = ['package.json', 'package-lock.json'];
// 「整個 App」：docs/ 以外的全部（含 scripts/：瀏覽器向 serve.mjs 要得到它們）。
export const APP_EXCLUDED_PREFIXES = ['docs/'];
// 讀檔路徑寫不死、但只在瀏覽器要檔時才讀的：瀏覽器測試的範圍已經涵蓋它會讀的，所以不因它退回整個 repo。
// 不是瀏覽器測試卻用到它 → 照常算判斷不出。
export const SUBSUMED_BY_BROWSER = new Set(['scripts/serve.mjs']);
export const isAppFile = (f) => !f.startsWith('docs/') && !f.startsWith('scripts/');
// docs/ 底下若出現可以被 import 的檔，App 的動態 import 就可能讀到它 → 「整個 App 不含 docs/」不成立
export const IMPORTABLE_RX = /\.(m?js|cjs|json|wasm|node)$/;

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
export const contentHash = (buf) => sha(buf);

const posix = (p) => p.split(path.sep).join('/');

/** 原始碼裡的相對 import（含 export … from、副作用 import、import('字面')）；bare 的套件名（puppeteer）不算檔案依賴。 */
export function staticImports(src) {
  const out = [];
  const rxs = [
    /^\s*import\s[^;]*?from\s*['"]([^'"]+)['"]/gm,
    /^\s*import\s*['"]([^'"]+)['"]/gm,
    /^\s*export\s[^;]*?from\s*['"]([^'"]+)['"]/gm,
    /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const rx of rxs) for (const m of String(src).matchAll(rx)) out.push(m[1]);
  return out.filter((s) => s.startsWith('.') || s.startsWith('/'));
}

/** 用到 puppeteer（瀏覽器測試）嗎 */
export function usesBrowser(src) {
  return /['"]puppeteer['"]/.test(String(src));
}

// 會讀檔或跑別的程式的呼叫。exec 不列（RegExp 的 .exec 太常見）；child_process.exec 本 repo 沒用，用了照樣會因為 spawn 類別以外的呼叫漏掉——
// 所以 gatescan 那種「已知壞寫法」之外，這裡另外把 'child_process' 的 exec 匯入也當成判斷不出（見 accessOf）。
const ACCESS_RX = /\b(readFileSync|readFile|readdirSync|readdir|existsSync|statSync|lstatSync|createReadStream|opendirSync|execFileSync|execFile|execSync|spawnSync|spawn|fork|fetch|Worker)\s*\(/g;
const LITERAL_JOIN_RX = /^\s*path\.join\(\s*ROOT\s*((?:,\s*'[^'`$\\]+'\s*)+)\)/;
const DYNAMIC_IMPORT_RX = /\bimport\(\s*(?!['"][^'"]+['"]\s*\))/g;

/**
 * 一個檔裡的讀檔／執行：寫死路徑的收集起來（repo 相對路徑），寫不死的記下理由。
 * 回 { literals: [路徑…], opaque: [理由…] }
 */
export function accessOf(src) {
  const s = String(src);
  const literals = []; const opaque = [];
  for (const m of s.matchAll(ACCESS_RX)) {
    const rest = s.slice(m.index + m[0].length);
    const j = LITERAL_JOIN_RX.exec(rest);
    if (j) literals.push(posix([...j[1].matchAll(/'([^']+)'/g)].map((x) => x[1]).join('/')));
    else opaque.push(`${m[1]}(…) 的路徑不是寫死的`);
  }
  for (const _ of s.matchAll(DYNAMIC_IMPORT_RX)) opaque.push('import( 接的不是字面');
  if (/\bexec\b[^;\n]*from\s*['"](node:)?child_process['"]/.test(s) || /\{[^}]*\bexec\b[^}]*\}\s*=\s*require\(\s*['"](node:)?child_process['"]/.test(s)) opaque.push('用了 child_process 的 exec');
  return { literals, opaque };
}

/**
 * 從起點沿 import 走到底。回 Set（repo 相對路徑），另外掛兩個陣列：
 *   .missing     import 指到 repo 裡沒有的檔（「讀不到」不是「沒有關係」——呼叫端要退回整個 repo）
 *   .unreadable  在 repo 清單上、卻讀不出內容的檔
 */
export function importClosure(starts, has, readSrc) {
  const seen = new Set(); const stack = starts.filter((f) => has(f));
  const missing = []; const unreadable = [];
  while (stack.length) {
    const f = stack.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    if (!/\.(m?js|cjs)$/.test(f)) continue;
    let src;
    try { src = readSrc(f); } catch (e) { unreadable.push(`${f}（${String(e?.message ?? e).slice(0, 60)}）`); continue; }
    for (const spec of staticImports(src)) {
      const target = posix(path.posix.normalize(spec.startsWith('/') ? spec.slice(1) : path.posix.join(path.posix.dirname(f), spec)));
      if (!has(target)) { missing.push({ from: f, spec, target }); continue; }
      if (has(target) && !seen.has(target)) stack.push(target);
    }
  }
  seen.missing = missing; seen.unreadable = unreadable;
  return seen;
}

/**
 * 已知類別（登記制）：每一類怎麼進範圍寫在旁邊。**不在這張表上的檔＝未知類別 → 算進每一條突變的範圍**，
 * 它一改，所有突變都要重跑（v11 §5.18 第 1 點：改到不屬於任何已知類別的檔就全跑）。
 */
export const KNOWN_CATEGORIES = [
  { prefix: 'js/', how: '程式：照 import 關係圖；App 的檔' },
  { prefix: 'scripts/', how: '程式：照 import 關係圖；非程式的檔（帳本、基準清單）只經寫死路徑或整個 repo 進範圍' },
  { prefix: 'data/', how: '一律算進每一條' },
  { prefix: 'css/', how: 'App 的檔' },
  { prefix: 'icons/', how: 'App 的檔' },
  { prefix: 'docs/', how: '文件：只經寫死路徑或整個 repo 進範圍（serve.mjs 不送）' },
  { prefix: 'screenshots/', how: '文件附圖：只經整個 repo 進範圍' },
  { file: 'index.html', how: 'App 的檔' },
  { file: 'sw.js', how: 'App 的檔' },
  { file: 'manifest.webmanifest', how: 'App 的檔' },
  { file: 'package.json', how: '一律算進每一條' },
  { file: 'package-lock.json', how: '一律算進每一條' },
  { file: 'README.md', how: '文件：只經整個 repo 進範圍' },
  { file: 'CLAUDE.md', how: '文件：只經整個 repo 進範圍' },
  { file: '.gitignore', how: 'repo 設定：只經整個 repo 進範圍' },
  { file: '.gitattributes', how: 'repo 設定：只經整個 repo 進範圍' },
];
export const isKnownFile = (f) => KNOWN_CATEGORIES.some((c) => (c.prefix ? f.startsWith(c.prefix) : f === c.file));

/**
 * 一條突變的依賴範圍。
 * @param m { file, test }
 * @param files repo 裡全部的檔（相對路徑）
 * @param readSrc (相對路徑) → 內容字串
 * @returns { kind: 'node'|'browser'|'app'|'repo', files: Set, reasons: [] }
 */
export function scopeFor(m, files, readSrc) {
  const all = new Set(files);
  const has = (f) => all.has(f);
  const testFile = `scripts/${m.test}.mjs`;
  const closure = importClosure([testFile, m.file], has, readSrc);
  // 突變的目標檔與測試檔，就算不存在也要在範圍裡（不存在本身就是一種狀態，雜湊會記成「沒有這個檔」）
  closure.add(m.file); closure.add(testFile);
  const literals = []; const opaque = [];
  // 讀不到、指到不存在的檔：不是「沒有關係」，是判斷不出（v11 §5.18 第 1 點；§5.13）
  for (const x of closure.missing ?? []) opaque.push({ f: x.from, r: `import 指到 repo 裡沒有的檔（${x.from} → ${x.spec}）`, hard: true, target: x.target });
  for (const x of closure.unreadable ?? []) opaque.push({ f: x, r: '讀不到內容', hard: true });
  let browser = false;
  for (const f of closure) {
    if (!has(f) || !/\.(m?js|cjs)$/.test(f)) continue;
    let src;
    try { src = readSrc(f); } catch { continue; }                     // 讀不到的已經在 closure.unreadable 裡
    if (usesBrowser(src)) browser = true;
    const a = accessOf(src);
    literals.push(...a.literals);
    for (const r of a.opaque) opaque.push({ f, r });
  }
  // App 自己的程式裡寫不死的 fetch、import(：只會載 App 的檔 → 「整個 App」（規則 4）
  const appOpaque = opaque.some((o) => !o.hard && isAppFile(o.f));
  const wholeApp = browser || appOpaque;
  // 指到不存在的檔：整個 App 的範圍（docs/ 以外全部）已經涵蓋那個位置的話，它日後出現也會被算進來 → 不必退回整個 repo。
  // 瀏覽器測試在 page.evaluate 裡動態載入 js/store.js（相對於頁面的路徑）是在頁面裡執行的，從測試檔的位置解析會落空，就是這一種。
  const coveredMissing = (o) => wholeApp && o.target && !APP_EXCLUDED_PREFIXES.some((p) => o.target.startsWith(p));
  const reasons = opaque
    .filter((o) => (o.hard ? !coveredMissing(o) : (!(browser && SUBSUMED_BY_BROWSER.has(o.f)) && !isAppFile(o.f))))
    .map((o) => `${o.f}：${o.r}`);
  if (wholeApp) {
    const docsModules = files.filter((f) => APP_EXCLUDED_PREFIXES.some((p) => f.startsWith(p)) && IMPORTABLE_RX.test(f));
    for (const f of docsModules) reasons.push(`${f}：docs/ 底下有可以被 import 的檔（「整個 App 不含 docs/」不成立）`);
  }
  const repoAll = () => new Set([...all, m.file, testFile].filter((f) => f !== LEDGER_FILE));
  if (reasons.length) return { kind: 'repo', files: repoAll(), reasons };
  const out = new Set(closure);
  for (const f of files) {
    if (ALWAYS_FILES.includes(f) || ALWAYS_PREFIXES.some((p) => f.startsWith(p))) out.add(f);
    if (wholeApp && !APP_EXCLUDED_PREFIXES.some((p) => f.startsWith(p))) out.add(f);
    // 寫死的讀檔路徑：剛好是那個檔，或是那個資料夾底下的
    if (literals.some((l) => f === l || f.startsWith(`${l.replace(/\/$/, '')}/`))) out.add(f);
    // 未知類別：算進每一條（它一改就全跑）
    if (!isKnownFile(f)) out.add(f);
  }
  for (const l of literals) out.add(l);
  out.delete(LEDGER_FILE);
  return { kind: browser ? 'browser' : appOpaque ? 'app' : 'node', files: out, reasons };
}

/** 範圍的雜湊：每個檔「路徑＋內容雜湊」排序後再雜湊。不存在的檔記成 MISSING（存在與否也是狀態）。 */
export function scopeHash(scopeFiles, fileHash) {
  const lines = [...scopeFiles].sort().map((f) => `${f}\0${fileHash(f) ?? 'MISSING'}`);
  return sha(lines.join('\n'));
}

/** 突變本身的雜湊：名稱、目標檔、找什麼、換成什麼、由哪支測試驗、expect、那支測試的逾時 */
export function mutationDefHash(m, timeoutMin = null) {
  return sha(JSON.stringify([m.name, m.file, m.find, m.replace, m.test, m.expect ?? null, timeoutMin]));
}

/**
 * 執行器的原始碼，拿掉 MUTATIONS 陣列那一段（加一條突變不該讓全部的突變都變成「執行器改了」；
 * 每一條突變自己的內容由 mutationDefHash 管）。找不到陣列的頭尾 → 丟錯（不默默用整份或空字串）。
 */
export function maskMutations(src) {
  const s = String(src);
  const a0 = s.indexOf('const MUTATIONS = [\n');
  const a1 = a0 < 0 ? -1 : s.indexOf('\n];\n', a0);
  if (a0 < 0 || a1 < 0) throw new Error('mutationtest.mjs 找不到 MUTATIONS 陣列的頭尾，執行器的雜湊算不出來');
  return s.slice(0, a0) + 'const MUTATIONS = [/* 由 mutationDefHash 管 */' + s.slice(a1);
}

/** 執行器的雜湊：mutationtest.mjs（拿掉突變清單）＋它 import 的全部檔 */
export function runnerHash(files, readSrc, fileHash, runner = 'scripts/mutationtest.mjs') {
  const has = (f) => files.includes(f);
  const closure = importClosure([runner], has, readSrc);
  // 執行器自己的 import 讀不到或指到不存在的檔：雜湊不代表執行器 → 停（§5.13），不默默少算一支
  if (closure.missing.length || closure.unreadable.length || !closure.has(runner)) {
    throw new Error(`執行器的雜湊算不出來：${[...closure.missing.map((x) => `${x.from} → ${x.spec}`), ...closure.unreadable, ...(closure.has(runner) ? [] : [`${runner} 不在檔案清單上`])].join('、')}`);
  }
  const lines =[...closure].sort().map((f) => `${f}\0${f === runner ? sha(maskMutations(readSrc(f))) : (fileHash(f) ?? 'MISSING')}`);
  return sha(lines.join('\n'));
}

/**
 * 這一條要不要跑：回理由陣列，空的＝沿用上次的結果。
 * cur：{ defHash, depHash, runnerHash }；entry：帳本裡這一條（沒有＝從沒跑過）
 */
export const RERUN = { NEVER: '從沒跑過', DEF: '突變本身改了', DEP: '依賴範圍裡有檔案改了', RUNNER: '執行器改了', NOT_RED: '上次沒有紅', UNCOUNTED: '上次不算數（逾時、被殺、沒跑起來）', NO_HASH: '上次沒有記雜湊' };
export function rerunReasons(entry, cur) {
  const last = entry?.last;
  if (!last) return [RERUN.NEVER];
  const r = [];
  if (!last.defHash || !last.depHash || !last.runnerHash) r.push(RERUN.NO_HASH);
  if (last.defHash && last.defHash !== cur.defHash) r.push(RERUN.DEF);
  if (last.depHash && last.depHash !== cur.depHash) r.push(RERUN.DEP);
  if (last.runnerHash && last.runnerHash !== cur.runnerHash) r.push(RERUN.RUNNER);
  if (last.counted === false) r.push(RERUN.UNCOUNTED);
  else if (last.red !== true) r.push(RERUN.NOT_RED);
  return r;
}

// ---- 帳本 ----
// 形狀：{ note, entries: { [突變名稱]: { last: 紀錄, lastFull: 紀錄|null } } }
// 紀錄：{ date, commit, mode, kind, counted, red, seconds, defHash, depHash, runnerHash, scope }
// last：最近一次跑（不論跑法）。lastFull：最近一次在「整套」或「補跑從未整套跑過的」裡跑、而且算數的那一次。
//   補跑也記進 lastFull：每條突變都是「改壞→跑一支測試→還原」，不帶狀態到下一條，在同一個 commit 上單獨跑跟在整套裡跑結果一樣。
export const LEDGER_NOTE = '每條突變上次在哪個 commit、用哪種跑法跑過、紅了沒（scripts/depgraph.mjs）。mutationtest 每跑完一條就寫一次；npm run sincefull -- --list 列出從沒在整套裡跑過的。';
export const FULL_MODES = new Set(['full', 'never-full']);

export function emptyLedger() { return { note: LEDGER_NOTE, entries: {} }; }

export function ledgerProblems(j) {
  const out = [];
  if (!j || typeof j !== 'object' || !j.entries || typeof j.entries !== 'object') return ['帳本沒有 entries'];
  for (const [name, e] of Object.entries(j.entries)) {
    if (!e || typeof e !== 'object') { out.push(`${name}：不是物件`); continue; }
    for (const k of ['last', 'lastFull']) {
      const r = e[k];
      if (r == null) continue;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date ?? '')) out.push(`${name}.${k}：日期看不懂`);
      if (!/^[0-9a-f]{7,40}(\+dirty)?$/.test(r.commit ?? '')) out.push(`${name}.${k}：commit 看不懂`);
      if (typeof r.red !== 'boolean') out.push(`${name}.${k}：red 不是 true／false`);
    }
    if (e.lastFull && !FULL_MODES.has(e.lastFull.mode)) out.push(`${name}.lastFull：跑法 ${e.lastFull.mode} 不是整套或補跑`);
  }
  return out;
}

/** 記一次結果進帳本（就地改 ledger；回傳同一個物件） */
export function recordRun(ledger, name, rec) {
  const e = ledger.entries[name] ?? (ledger.entries[name] = { last: null, lastFull: null });
  e.last = rec;
  if (FULL_MODES.has(rec.mode) && rec.counted) e.lastFull = rec;
  return ledger;
}

/**
 * 帳本的孤兒（v11 §5.18 第 4 點、§5.2 登記制配孤兒檢查）：
 *   notInLedger  清單有、帳本沒有任何紀錄的（＝從沒跑過，也列在 neverFullNames 裡）
 *   notInList    帳本有、清單已經沒有的（突變被刪或改名）——要報，不默默留著
 */
export function ledgerOrphans(names, ledger) {
  const list = new Set(names); const led = Object.keys(ledger?.entries ?? {});
  return { notInLedger: names.filter((n) => !ledger?.entries?.[n]), notInList: led.filter((n) => !list.has(n)) };
}

/** 從沒在整套（或補跑）裡跑過的：現在的突變名稱裡，帳本沒有 lastFull 的。改名的算沒跑過（保守） */
export function neverFullNames(names, ledger) {
  return names.filter((n) => !ledger?.entries?.[n]?.lastFull);
}

/**
 * 「整套跑完」的判定（分段跑時用）：每一條突變在這個 commit 上都有算數的結果、而且雜湊都是現在的。
 * 少一條、多一條（帳本裡有、清單上沒有的不算）、雜湊對不上，都不算跑完。回 { complete, missing: [名稱…] }
 */
export function fullComplete(names, ledger, commit, curOf) {
  const missing = names.filter((n) => !doneAt(ledger?.entries?.[n], commit, curOf(n)));
  return { complete: names.length > 0 && missing.length === 0, missing };
}

/** 這一條在這個 commit 上，已經用整套或補跑、算數地跑過，而且三個雜湊都是現在的嗎（整套續跑時跳過它） */
export function doneAt(entry, commit, cur) {
  const l = entry?.last;
  if (!l || commit === null || l.commit !== commit || !l.counted || !FULL_MODES.has(l.mode)) return false;
  return l.defHash === cur.defHash && l.depHash === cur.depHash && l.runnerHash === cur.runnerHash;
}

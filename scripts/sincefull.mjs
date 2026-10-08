// 距上次全面檢測、距上次突變整套各多久（npm run sincefull）。每版回報最後那兩行就是它印的。
// 規格：docs/SPEC_測試範圍_修訂一.md §2-4。
//
// 讀 docs/STATUS.md「測試現況」裡兩行固定格式的紀錄：
//   上次全面檢測：YYYY-MM-DD、mealmate-vX.Y.Z、…
//   上次突變整套：YYYY-MM-DD、mealmate-vX.Y.Z、N 條、…
// 格式對不上就報錯、exit 1 —— 印成「0 天」的話，看起來像剛跑過，這兩行存在的意義就沒了。
// 純函式（parseCheckLines、daysSince、mutationNames、neverRunNames、shouldRecordFull、chainExcludesMutation…）給 doctest 驗。

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { LEDGER_FILE, ledgerProblems, ledgerOrphans, isUnmeasurable } from './depgraph.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

const FULL_RE = /^上次全面檢測：(\d{4}-\d{2}-\d{2})、(mealmate-v\d+\.\d+\.\d+)、/m;
const MUT_RE = /^上次突變整套：(\d{4}-\d{2}-\d{2})、(mealmate-v\d+\.\d+\.\d+)、(\d+) 條、/m;

export function parseCheckLines(statusText) {
  const text = String(statusText ?? '');
  const f = FULL_RE.exec(text);
  if (!f) throw new Error('STATUS 找不到「上次全面檢測：日期、版本、…」那一行（或格式對不上）');
  const m = MUT_RE.exec(text);
  if (!m) throw new Error('STATUS 找不到「上次突變整套：日期、版本、N 條、…」那一行（或格式對不上）');
  for (const d of [f[1], m[1]]) if (Number.isNaN(new Date(`${d}T00:00:00+08:00`).getTime())) throw new Error(`STATUS 的日期看不懂：${d}`);
  // 耗時（SPEC_嫩莢豆芽與蛋白質門檻 §8）：「約 N 秒」或「無紀錄」；兩行都一定要有這個欄位，缺了就是格式壞了
  const lineOf = (prefix) => text.split('\n').find((l) => l.startsWith(prefix)) ?? '';
  const ft = /總耗時 (無紀錄|約 [\d,]+ 秒)/.exec(lineOf('上次全面檢測：'));
  if (!ft) throw new Error('STATUS「上次全面檢測」那一行找不到「總耗時 約 N 秒」或「總耗時 無紀錄」');
  const mt = /、耗時 (無紀錄|約 [\d,]+ 秒)/.exec(lineOf('上次突變整套：'));
  if (!mt) throw new Error('STATUS「上次突變整套」那一行找不到「耗時 約 N 秒」或「耗時 無紀錄」');
  return { full: { date: f[1], version: f[2], took: ft[1] }, mut: { date: m[1], version: m[2], count: Number(m[3]), took: mt[1] } };
}

// 「約 14,800 秒」→「約 14,800 秒（約 4.1 小時）」；「無紀錄」照實印（不印 0、不省略）
export function tookText(took) {
  if (took === '無紀錄') return '無紀錄';
  const sec = Number(String(took).replace(/[^\d]/g, ''));
  return sec >= 3600 ? `${took}（約 ${(sec / 3600).toFixed(1)} 小時）` : sec >= 60 ? `${took}（約 ${Math.round(sec / 60)} 分鐘）` : String(took);
}

// ---- 整套的上限（共用慣例 v3 §5.7：上限由各 App 自己定，超過才在回報最前面提）----
// MealMate 的上限：距上次突變整套 10 版，或從未整套跑過的突變 40 條（統籌者依 2026-09-19～21 的實測訂的：
// 366 條裡 3 條失效；v0.37.0 之後 191 條重跑 0 條失效）。數字同時寫在 STATUS「測試現況」，doctest 會比對兩邊。
// 2026-10-02 Dispatch 加兩條機械判準（「較大的版本」，任一條成立就要全跑）：距上次整套超過 14 天、從沒整套跑過 30 條以上。
// never 是「以上」（≥），versions、days 是「超過」（>）。
export const FULL_LIMITS = { versions: 10, never: 30, days: 14 };

// 超過任一上限 → 回一行字（印在兩行提醒的**最前面**）；沒超過回 null（不是空字串，照舊完全不提）
export function overLimitLine({ versMut, never, daysMut = 0 }, limits = FULL_LIMITS) {
  const over = [];
  if (versMut > limits.versions) over.push(`距上次突變整套 ${versMut} 版（上限 ${limits.versions} 版）`);
  if (never >= limits.never) over.push(`從未整套跑過 ${never} 條（${limits.never} 條以上就要全跑）`);
  if (daysMut > limits.days) over.push(`距上次突變整套 ${daysMut} 天（超過 ${limits.days} 天）`);
  return over.length ? `已超過上限（${over.join('；')}），建議這一批做完就跑` : null;
}

// 每版回報最後那兩行。純函式：版數、天數、條數由呼叫端算好餵進來
export function reminderLines(parsed, { versFull, versMut, daysFull, daysMut, never }) {
  return [
    `距上次全面檢測（${parsed.full.version}，${parsed.full.date}）：${versFull} 版／${daysFull} 天；上次實測耗時${tookText(parsed.full.took)}`,
    `距上次突變整套（${parsed.mut.version}，${parsed.mut.date}）：${versMut} 版／${daysMut} 天；其中 ${never} 條從未整套跑過；上次實測耗時${tookText(parsed.mut.took)}`,
  ];
}

// 以台灣的日曆日算：今天 − 那一天
export function daysSince(dateIso, today) {
  const d = new Date(`${dateIso}T00:00:00+08:00`);
  const t = new Date(today);
  if (Number.isNaN(d.getTime()) || Number.isNaN(t.getTime())) throw new Error('日期看不懂');
  const day = (x) => Math.floor((x.getTime() + 8 * 3600000) / 86400000);
  return day(t) - day(d);
}

// ---- 從未整套跑過的突變：按名稱比對（docs/SPEC_sincefull_按名稱計數.md） ----
// 以前用「現在的條數 − 上次整套的條數」：只要刪過或改名過突變，這個數字就系統性偏低，而偏低的方向正好是「讓人以為不急」
// （v0.36.1 時條數相減得 3、照名稱算是 5）。改成：現在的突變名稱裡，不在上次整套基準清單上的。改名的算沒跑過（保守）。
export const LASTFULL_FILE = 'scripts/mutation-lastfull.json';

// mutationtest.mjs 裡每一條的 name（依檔案順序；單引號、雙引號都認）
export function mutationNames(src) {
  return [...String(src).matchAll(/^ {4}name: (["'])(.*?)\1,\s*$/gm)].map((m) => m[2]);
}

export function neverRunNames(currentNames, baselineNames) {
  const base = new Set(baselineNames);
  return currentNames.filter((n) => !base.has(n));
}

// 已知量不到、刻意保留的突變名稱（突變清單裡帶 unmeasurable 的；判斷照 depgraph.isUnmeasurable）——2026-10-09 Dispatch：
// 它永遠不會有 lastFull，算進「從未整套跑過」會讓那個數字永遠多一條雜訊。讀法跟 checkmutations.loadMutations 一樣（執行清單的字面）；
// 不 import checkmutations：它會把 assertregistry 帶進每一支 import sincefull 的程式的依賴範圍。讀不到清單 → 丟錯，不當成 0 條
export function unmeasurableNames(src) {
  const s = String(src); const a = s.indexOf('const MUTATIONS = ['); const b = s.indexOf('\n];', a);
  if (a < 0 || b < 0) throw new Error('mutationtest.mjs 裡找不到突變清單（const MUTATIONS = [ … ];）');
  // eslint-disable-next-line no-new-func
  return new Function(`return ${s.slice(a + 'const MUTATIONS = '.length, b + 2)};`)().filter(isUnmeasurable).map((m) => m.name);
}
/** 從未整套跑過的，分成真的要補跑的、跟刻意保留的 */
export function splitParked(missing, parkedNames) {
  const p = new Set(parkedNames);
  return { real: missing.filter((n) => !p.has(n)), parked: missing.filter((n) => p.has(n)) };
}

// 基準清單本身的問題（空的、有重複）；沒有問題回 []
export function lastFullProblems(j) {
  const out = [];
  if (!Array.isArray(j?.names) || j.names.length === 0) out.push('names 是空的');
  else if (new Set(j.names).size !== j.names.length) out.push('names 有重複');
  return out;
}

// 基準清單的日期、版本、條數跟 STATUS「上次突變整套」那一行一致嗎（兩邊各記一份，漂開了 doctest 要紅）
export function lastFullMatchesStatus(j, parsed) {
  return j?.date === parsed?.mut?.date && j?.version === parsed?.mut?.version && (j?.names?.length ?? -1) === parsed?.mut?.count;
}

export function readLastFull(root = ROOT) {
  const j = JSON.parse(fs.readFileSync(path.join(root, LASTFULL_FILE), 'utf8'));
  const problems = lastFullProblems(j);
  if (problems.length) throw new Error(`${LASTFULL_FILE}：${problems.join('、')}`);
  return j;
}

// 什麼時候可以寫基準：人明確下 --record-full（分段補跑，由人確認）；或不帶 --only、每一條都跑到了（沒有中斷、沒有漏跑）。
// 中斷的話程式根本走不到寫檔那一步；帶 --only 或基準沒過（一條都沒跑）都不寫。
export function shouldRecordFull({ only, ran, total, recordFlag = false }) {
  if (recordFlag) return true;
  return !only && total > 0 && ran === total;
}

export function writeLastFull(file, { date, version, names }) {
  const note = '上次整套跑過的突變名稱。npm run sincefull 用它算「幾條從未整套跑過」（照名稱比對，改名的算沒跑過）；mutationtest 不帶 --only 完整跑完時自動重寫，分段補跑時用 npm run sincefull -- --record-full 手動寫。';
  fs.writeFileSync(file, `${JSON.stringify({ date, version, note, names }, null, 1)}\n`, 'utf8');
}

// 每條突變的帳本（scripts/depgraph.mjs）。讀不到、讀不懂就丟錯——不當成「全部都沒跑過」或「全部都跑過」。
export function readLedger(root = ROOT) {
  const file = path.join(root, LEDGER_FILE);
  if (!fs.existsSync(file)) throw new Error(`找不到 ${LEDGER_FILE}`);
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  const problems = ledgerProblems(j);
  if (problems.length) throw new Error(`${LEDGER_FILE}：${problems.slice(0, 3).join('、')}`);
  return j;
}

/** 帳本裡有 lastFull（在整套或補跑裡算數地跑過）的名稱 */
export function namesWithFull(ledger) {
  return Object.keys(ledger?.entries ?? {}).filter((n) => ledger.entries[n]?.lastFull);
}
/** 上次整套名單上、帳本卻沒有 lastFull 的（兩份對不上）：回名稱陣列，空的＝對得上 */
export function lastFullNotInLedger(lastFullNames, ledger) {
  return neverRunNames(lastFullNames, namesWithFull(ledger));
}

export function currentVersion(root = ROOT) {
  return /APP_VERSION = '([^']+)'/.exec(fs.readFileSync(path.join(root, 'js/version.js'), 'utf8'))?.[1] ?? null;
}
export function taiwanToday(now = new Date()) {
  return new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10);
}
// 修訂一 D3 的 neverRunCount（條數相減）由上面的 neverRunNames 取代（2026-09-19）。

// npm test 的鏈不能含 mutationtest（它會暫時改寫原始碼、跑三十分鐘以上；是獨立指令）
export function chainExcludesMutation(pkg) {
  const s = pkg?.scripts?.test;
  if (typeof s !== 'string' || !s.trim()) return false;
  return !s.split('&&').some((seg) => /\bmutationtest\b/.test(seg));
}

/** package.json 測試鏈登記的測試，依序、不含副檔名（`node scripts/xxx.mjs && …`）。 */
export function testsInChain(pkg) {
  const s = pkg?.scripts?.test;
  if (typeof s !== 'string') return [];
  return [...s.matchAll(/node scripts\/([\w-]+)\.mjs/g)].map((m) => m[1]);
}

/**
 * assertaudit 要掃哪些測試（2026-09-24 起）：**只認測試鏈登記過的**，不看 scripts/ 底下有什麼檔。
 * 以前是「scripts/*.mjs 扣掉略過清單」——預設所有東西都是測試、除非有人記得排除，
 * 新加的工具沒進略過清單就會紅（2026-09-19 sincefull.mjs、2026-09-24 selfcheck.mjs 各一次，都要等全面檢測才發現）。
 * scriptFiles 只拿來確認登記的測試檔真的存在；不在裡面的照樣列出來，讓呼叫端的斷言喊出來。
 */
export function auditTargets(pkg, scriptFiles) {
  void scriptFiles;
  return testsInChain(pkg).map((n) => `${n}.mjs`);
}

/** 檔名像測試（*test.mjs）卻沒登記進測試鏈的——新測試忘了登記，npm test 不會跑、assertaudit 也不會掃。 */
// 刻意不在鏈裡：mutationtest 會改寫原始碼、要跑幾小時（doctest D4）；jobtest（2026-10-08）會開好幾支程序（Git Bash、sleep、
// PowerShell 協助程序）去驗 Job Object 殺不殺得乾淨，約 75 秒（2026-10-08 加了逐一計數那一節之後）、只在 Windows 有意義，單獨跑 node scripts/jobtest.mjs；
// memwatchtest（2026-10-08）開假執行器、外部監看與一個瀏覽器，約 1 分鐘、只在 Windows 有意義，單獨跑 node scripts/memwatchtest.mjs
// entrysweeptest（2026-10-08）：三個入口的收拾行為情境——開暫存 clone、殺子程序、開入口，約 1–2 分鐘，只在 Windows 有意義，單獨跑 node scripts/entrysweeptest.mjs
export const CHAIN_EXEMPT = new Set(['mutationtest', 'jobtest', 'memwatchtest', 'entrysweeptest']);
export function orphanTests(pkg, scriptFiles) {
  const chain = new Set(testsInChain(pkg));
  return scriptFiles.filter((f) => /test\.mjs$/.test(f)).map((f) => f.replace(/\.mjs$/, ''))
    .filter((n) => !chain.has(n) && !CHAIN_EXEMPT.has(n));
}

export function mutationCount(root = ROOT) {
  return (fs.readFileSync(path.join(root, 'scripts/mutationtest.mjs'), 'utf8').match(/^ {4}name: /gm) ?? []).length;
}

// 從某一版（sw.js 的 VERSION 第一次變成它）到 HEAD 又發了幾版
function versionsSince(version) {
  const git = (args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  const intro = git(['log', '--format=%h', '-S', `'${version}'`, '--', 'sw.js']).split('\n').filter(Boolean).pop();
  if (!intro) throw new Error(`git 歷史裡找不到 ${version}`);
  return git(['log', '--format=%h', '-G', "^const VERSION = '", `${intro}..HEAD`, '--', 'sw.js']).split('\n').filter(Boolean).length;
}

function main() {
  const mtSrc = fs.readFileSync(path.join(ROOT, 'scripts/mutationtest.mjs'), 'utf8');
  const current = mutationNames(mtSrc);
  // 分段補跑完整套之後，由人確認再寫基準：npm run sincefull -- --record-full（寫的是現在全部的突變名稱、今天、現在的版本）
  if (process.argv.includes('--record-full')) {
    const rec = { date: taiwanToday(), version: currentVersion(), names: current };
    writeLastFull(path.join(ROOT, LASTFULL_FILE), rec);
    console.log(`已寫入 ${LASTFULL_FILE}：${rec.date}、${rec.version}、${current.length} 條。記得把 STATUS「上次突變整套」那一行改成同樣的日期、版本、條數（doctest 會比對）。`);
    return;
  }
  const parsed = parseCheckLines(fs.readFileSync(path.join(ROOT, 'docs/STATUS.md'), 'utf8'));
  const today = new Date();
  // 從沒在整套裡跑過的：2026-10-01 起看每條突變的帳本（scripts/mutation-ledger.json 的 lastFull），不只看上次整套的名單。
  // 兩份要對得上：上次整套名單上的每一條，帳本都要有 lastFull——對不上就停（檢查器壞了，不是 0 條）。
  const ledger = readLedger();
  const withFull = namesWithFull(ledger);
  const notInLedger = lastFullNotInLedger(readLastFull().names, ledger);
  if (notInLedger.length) throw new Error(`${LASTFULL_FILE} 上有 ${notInLedger.length} 條在帳本裡沒有 lastFull（例如「${notInLedger[0]}」）——兩份對不上`);
  const { real: missing, parked } = splitParked(neverRunNames(current, withFull), unmeasurableNames(mtSrc));
  const never = missing.length;
  const versMut = versionsSince(parsed.mut.version);
  const lines = reminderLines(parsed, {
    versFull: versionsSince(parsed.full.version), versMut,
    daysFull: daysSince(parsed.full.date, today), daysMut: daysSince(parsed.mut.date, today), never,
  });
  const over = overLimitLine({ versMut, never, daysMut: daysSince(parsed.mut.date, today) });
  if (over) console.log(over);
  for (const l of lines) console.log(l);
  if (parked.length) console.log(`（另有刻意保留、已知量不到的 ${parked.length} 條，不算進「從未整套跑過」：${parked.join('、')}）`);
  if (process.argv.includes('--list')) {
    const orph = ledgerOrphans(current, ledger);
    console.log(`\n帳本的孤兒：清單有、帳本沒有任何紀錄的 ${orph.notInLedger.length} 條；帳本有、清單已經沒有的 ${orph.notInList.length} 條`);
    for (const n of orph.notInList) console.log(`  · 帳本有、清單沒有：${n}`);
    console.log(`\n從未整套跑過的 ${never} 條（帳本 ${LEDGER_FILE} 裡沒有 lastFull）：`);
    for (const n of missing) {
      const l = ledger.entries[n]?.last;
      console.log(`  · ${n}${l ? `（最近一次：${l.date}、${l.commit}、${l.mode}、${l.red ? '紅' : '沒紅'}）` : '（帳本裡沒有任何紀錄）'}`);
    }
  }
  // 每一條突變：上次在整套裡跑過是什麼時候、哪個 commit、紅了沒（Yolin 2026-10-01 新規則第 4 條）
  if (process.argv.includes('--each')) {
    console.log('\n每一條突變上次在整套（或補跑）裡跑過：');
    for (const n of current) {
      const f = ledger.entries[n]?.lastFull;
      console.log(`  · ${n}：${f ? `${f.date}、${f.commit}、${f.mode}、${f.red ? '紅' : '沒紅'}` : '從沒跑過'}`);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); } catch (e) { console.error(`✗ ${e.message}`); process.exit(1); }
}

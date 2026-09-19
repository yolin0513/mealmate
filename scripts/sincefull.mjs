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
  const current = mutationNames(fs.readFileSync(path.join(ROOT, 'scripts/mutationtest.mjs'), 'utf8'));
  // 分段補跑完整套之後，由人確認再寫基準：npm run sincefull -- --record-full（寫的是現在全部的突變名稱、今天、現在的版本）
  if (process.argv.includes('--record-full')) {
    const rec = { date: taiwanToday(), version: currentVersion(), names: current };
    writeLastFull(path.join(ROOT, LASTFULL_FILE), rec);
    console.log(`已寫入 ${LASTFULL_FILE}：${rec.date}、${rec.version}、${current.length} 條。記得把 STATUS「上次突變整套」那一行改成同樣的日期、版本、條數（doctest 會比對）。`);
    return;
  }
  const parsed = parseCheckLines(fs.readFileSync(path.join(ROOT, 'docs/STATUS.md'), 'utf8'));
  const today = new Date();
  const missing = neverRunNames(current, readLastFull().names);
  const never = missing.length;
  const lines = reminderLines(parsed, {
    versFull: versionsSince(parsed.full.version), versMut: versionsSince(parsed.mut.version),
    daysFull: daysSince(parsed.full.date, today), daysMut: daysSince(parsed.mut.date, today), never,
  });
  for (const l of lines) console.log(l);
  if (process.argv.includes('--list')) {
    console.log(`\n從未整套跑過的 ${never} 條（不在 ${LASTFULL_FILE} 上）：`);
    for (const n of missing) console.log(`  · ${n}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); } catch (e) { console.error(`✗ ${e.message}`); process.exit(1); }
}

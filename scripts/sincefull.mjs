// 距上次全面檢測、距上次突變整套各多久（npm run sincefull）。每版回報最後那兩行就是它印的。
// 規格：docs/SPEC_測試範圍_修訂一.md §2-4。
//
// 讀 docs/STATUS.md「測試現況」裡兩行固定格式的紀錄：
//   上次全面檢測：YYYY-MM-DD、mealmate-vX.Y.Z、…
//   上次突變整套：YYYY-MM-DD、mealmate-vX.Y.Z、N 條、…
// 格式對不上就報錯、exit 1 —— 印成「0 天」的話，看起來像剛跑過，這兩行存在的意義就沒了。
// 純函式（parseCheckLines、daysSince、neverRunCount、chainExcludesMutation）給 doctest 驗。

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

// 從來沒有整套跑過的突變條數＝現在的總條數 − 上次整套跑的條數
export function neverRunCount(total, parsed) {
  const n = total - parsed.mut.count;
  if (!Number.isInteger(n) || n < 0) throw new Error(`突變條數對不上：現在 ${total} 條、上次整套 ${parsed.mut.count} 條`);
  return n;
}

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
  const parsed = parseCheckLines(fs.readFileSync(path.join(ROOT, 'docs/STATUS.md'), 'utf8'));
  const today = new Date();
  const never = neverRunCount(mutationCount(), parsed);
  const lines = reminderLines(parsed, {
    versFull: versionsSince(parsed.full.version), versMut: versionsSince(parsed.mut.version),
    daysFull: daysSince(parsed.full.date, today), daysMut: daysSince(parsed.mut.date, today), never,
  });
  for (const l of lines) console.log(l);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); } catch (e) { console.error(`✗ ${e.message}`); process.exit(1); }
}

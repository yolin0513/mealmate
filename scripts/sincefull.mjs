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
  return { full: { date: f[1], version: f[2] }, mut: { date: m[1], version: m[2], count: Number(m[3]) } };
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
  console.log(`距上次全面檢測（${parsed.full.version}，${parsed.full.date}）：${versionsSince(parsed.full.version)} 版／${daysSince(parsed.full.date, today)} 天`);
  console.log(`距上次突變整套（${parsed.mut.version}，${parsed.mut.date}）：${versionsSince(parsed.mut.version)} 版／${daysSince(parsed.mut.date, today)} 天；其中 ${never} 條從未整套跑過`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); } catch (e) { console.error(`✗ ${e.message}`); process.exit(1); }
}

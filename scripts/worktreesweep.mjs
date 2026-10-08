// 收掉被殺的那一層留下的 worktree（2026-10-08，第 7 項）。
//
// doctest 的共用暫存 worktree、gatemutants、buildguard-verify 都在暫存目錄建 worktree，正常結束時在 finally／exit 裡移除；
// 被 Job 或逾時殺掉時那一步跑不到，git 的 worktree 清單與暫存目錄就留下來。這支在各入口開頭跑一次：
//   · 名字要帶建立者：mm-<種類>-<PID>-<建立時間毫秒>-…（wtName 產生）。
//   · 只看這個 repo 的 worktree 清單裡、在暫存目錄底下、名字以 mm- 開頭的。
//   · 建立者的 PID 已經不在，或那個 PID 的程序比名字裡的建立時間還晚開（PID 被別人重用）→ 建立者已死 → 移除。
//   · 建立者還活著 → 不碰（巢狀跑時，外層還在用的不會被內層收掉）。
//   · 名字看不出建立者（舊格式）→ 只列出來、不收（不猜）。
//   · 收不掉的照實回報，不靜默跳過；查不到程序清單就一個都不收（不把「查不到」當成「已經死了」）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
// 命名的兩個純函式拆到 ownername.mjs（2026-10-08）：只要命名的（browserlib、瀏覽器測試）從那裡 import，不會把這支的動態路徑帶進它們的範圍
import { wtPrefix, ownerOf } from './ownername.mjs';
export { wtPrefix, ownerOf };

/**
 * 判斷要不要收：procs＝Map(pid → 建立時間毫秒)。回 'live'（不碰）／'dead'（收）／'unknown'（舊格式，只列）。
 * 純函式：測試直接餵情境。
 */
export function judge(p, procs) {
  const o = ownerOf(p);
  if (!o) return 'unknown';
  if (!procs.has(o.pid)) return 'dead';
  // 那個 PID 的程序比 worktree 晚開（容許 2 秒的時鐘誤差）→ PID 被重用，原本的建立者已死
  return procs.get(o.pid) > o.at + 2000 ? 'dead' : 'live';
}

/** 這台機器的程序：Map(pid → 建立時間毫秒)。查不到就丟例外（呼叫端一個都不收）。 */
export function liveProcs() {
  if (process.platform !== 'win32') throw new Error('不是 Windows：沒有實作程序清單');
  const raw = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command',
    'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $(if ($_.CreationDate) { [DateTimeOffset]::new($_.CreationDate).ToUnixTimeMilliseconds() } else { 0 })" }'],
  { encoding: 'utf8', maxBuffer: 1 << 26, timeout: 60000 });
  const m = new Map();
  for (const l of raw.split(/\r?\n/)) { const [a, b] = l.trim().split(' '); if (/^\d+$/.test(a ?? '')) m.set(Number(a), Number(b)); }
  if (!m.has(process.pid)) throw new Error('程序清單裡查不到自己——查詢壞了');
  return m;
}

/** 這個 repo 的 worktree 裡，在暫存目錄底下、mm- 開頭的那幾個（不含主工作區） */
export function tempWorktrees(repo) {
  const out = execFileSync('git', ['-C', repo, 'worktree', 'list', '--porcelain'], { encoding: 'utf8', timeout: 60000 });
  const tmp = path.resolve(os.tmpdir()).toLowerCase();
  return out.split(/\r?\n/).filter((l) => l.startsWith('worktree ')).map((l) => l.slice('worktree '.length).trim())
    .filter((p) => path.resolve(p).toLowerCase().startsWith(tmp) && /[\\/]mm-[a-z]+-/.test(p));
}

/** 這台機器每一支程序的指令列（判斷「還有沒有程序在用那個路徑」）。查不到、或查不到自己 → 丟例外（呼叫端一個都不收） */
export function liveCmdlines() {
  const raw = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command',
    'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId)`t$($_.CommandLine)" }'], { encoding: 'utf8', maxBuffer: 1 << 26, timeout: 60000 });
  const rows = raw.split(/\r?\n/).filter(Boolean).map((l) => { const i = l.indexOf('\t'); return { pid: Number(l.slice(0, i)), cmd: l.slice(i + 1) }; });
  if (!rows.some((x) => x.pid === process.pid)) throw new Error('指令列清單裡查不到自己——查詢壞了');
  return rows.map((x) => x.cmd);
}

/**
 * 暫存目錄裡本專案自己命名的東西（2026-10-08，Dispatch：共用機器上的暫存目錄，清理一律只能清自己建立、名字帶得出建立者的）：
 * 只看登記的種類（mm-chrome-：瀏覽器設定檔、mm-jobmark-：D18p 的標記檔），名字一定帶 PID＋建立時間。
 * 建立者已死（PID 不在、或被重用）才收；**還有活著的程序在指令列裡引用那個路徑（例：還開著的 Chrome 的 --user-data-dir）→ 不收**——
 * CertQuiz 那次就是對一個正在使用中的設定檔目錄執行了刪除。查不到程序清單或指令列 → 一個都不收。
 */
export const OWNED_TEMP_KINDS = ['chrome', 'jobmark'];
export function sweepOwnedTemp({ procs = liveProcs, cmdlines = liveCmdlines, dir = os.tmpdir(), log = () => {} } = {}) {
  const t = { removed: [], kept: [], inUse: [], failed: [], error: null };
  let names;
  try { names = fs.readdirSync(dir).filter((n) => OWNED_TEMP_KINDS.some((k) => n.startsWith(`mm-${k}-`))); } catch (e) { t.error = `讀不到暫存目錄：${e.message}`; log(`· 暫存收拾：${t.error}——一個都不收`); return t; }
  if (!names.length) return t;
  let pm; let cl;
  try { pm = procs(); cl = cmdlines().map((c) => String(c ?? '').toLowerCase()); } catch (e) { t.error = `查不到程序清單：${e.message}`; log(`· 暫存收拾：${t.error}——一個都不收（${names.length} 項）`); return t; }
  for (const n of names) {
    const p = path.join(dir, n);
    if (judge(p, pm) !== 'dead') { t.kept.push(n); continue; }
    if (cl.some((c) => c.includes(p.toLowerCase()))) { t.inUse.push(n); continue; }
    try { fs.rmSync(p, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch { /* 下面用 existsSync 驗 */ }
    if (fs.existsSync(p)) t.failed.push(n); else t.removed.push(n);
  }
  const parts = [];
  if (t.removed.length) parts.push(`收掉 ${t.removed.length} 項建立者已死的（${t.removed.join('、')}）`);
  if (t.inUse.length) parts.push(`建立者已死、但還有程序在用、不收 ${t.inUse.length} 項（${t.inUse.join('、')}）`);
  if (t.failed.length) parts.push(`⚠ 收不掉 ${t.failed.length} 項（${t.failed.join('、')}）`);
  if (parts.length) log(`· 暫存收拾：${parts.join('；')}`);
  return t;
}

/**
 * 收掉建立者已死的。回 { removed: [], failed: [{ path, why }], kept: [], unknown: [], error, temp }，並印一行（有事才印）。
 * 先收暫存目錄裡本專案自己命名的（sweepOwnedTemp；結果在 temp），再收 worktree。
 * procs：程序清單從哪裡來（函式，回 Map(pid → 建立時間毫秒)；查不到就丟例外）。正式入口都不傳、用這台機器的 liveProcs；
 * doctest 傳一支會失敗的，驗「查不到就一個都不收」這條失敗路徑（把依賴當參數傳入，不是讀環境變數的後門）。
 */
export function sweep(repo, { procs = liveProcs, cmdlines = liveCmdlines, tempDir = os.tmpdir(), log = (s) => console.log(s) } = {}) {
  const r = { removed: [], failed: [], kept: [], unknown: [], error: null, temp: null };
  r.temp = sweepOwnedTemp({ procs, cmdlines, dir: tempDir, log });
  let list;
  try { list = tempWorktrees(repo); } catch (e) { r.error = `讀不到 worktree 清單：${e.message}`; log(`· worktree 收拾：${r.error}——一個都不收`); return r; }
  if (!list.length) return r;
  let pm;
  try { pm = procs(); } catch (e) { r.error = `查不到程序清單：${e.message}`; log(`· worktree 收拾：${r.error}——一個都不收（暫存 worktree ${list.length} 個）`); return r; }
  for (const p of list) {
    const j = judge(p, pm);
    if (j === 'live') { r.kept.push(p); continue; }
    if (j === 'unknown') { r.unknown.push(p); continue; }
    const rm = spawnSync('git', ['-C', repo, 'worktree', 'remove', '--force', p], { encoding: 'utf8', timeout: 60000 });
    // 目錄：mkdtemp 那一層（mm-…）整個刪；worktree 就是那一層時一樣
    const top = String(p).split(/[\\/]/).findIndex((s) => /^mm-[a-z]+-/.test(s));
    const topDir = top >= 0 ? String(p).split(/[\\/]/).slice(0, top + 1).join(path.sep) : p;
    try { fs.rmSync(topDir, { recursive: true, force: true }); } catch { /* 下面用 existsSync 驗 */ }
    if (rm.status !== 0 && fs.existsSync(p)) r.failed.push({ path: p, why: (rm.stderr || rm.error?.message || '').trim().slice(0, 160) });
    else r.removed.push(p);
  }
  spawnSync('git', ['-C', repo, 'worktree', 'prune'], { encoding: 'utf8', timeout: 60000 });
  const parts = [];
  if (r.removed.length) parts.push(`收掉 ${r.removed.length} 個建立者已死的（${r.removed.map((p) => path.basename(path.dirname(p)) === path.basename(os.tmpdir()) ? path.basename(p) : `${path.basename(path.dirname(p))}/${path.basename(p)}`).join('、')}）`);
  if (r.failed.length) parts.push(`⚠ 收不掉 ${r.failed.length} 個（${r.failed.map((f) => `${path.basename(f.path)}：${f.why}`).join('；')}）`);
  if (r.unknown.length) parts.push(`名字看不出建立者、不收 ${r.unknown.length} 個（${r.unknown.map((p) => path.basename(p)).join('、')}）`);
  if (r.kept.length) parts.push(`建立者還活著、不碰 ${r.kept.length} 個`);
  if (parts.length) log(`· worktree 收拾：${parts.join('；')}`);
  return r;
}

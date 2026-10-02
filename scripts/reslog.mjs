// 重負載的資源紀錄（共用慣例 v11 §5.19，2026-10-02）：超過 10 分鐘的工作，每 60 秒左右記一行
// 「時間、工作程序數、它們合計的記憶體、系統可用記憶體」到 .logs/。
//
// 數的是某一支主程式（--root，例如 mutationtest）底下的子孫程序：
//   · node、python 各算一個工作程序；瀏覽器實例算一個（瀏覽器自己再開的子程序不另算個數，但記憶體算進去）
//   · git、shell、powershell 這類短命的工具不算個數（記憶體照算）
//   · 記錄工具自己（--self 或本程序）與它開的子程序都不算
// 用法：node scripts/reslog.mjs --root <pid> --out <檔> [--interval 60]   （主程式結束就停）
//       node scripts/reslog.mjs --root <pid> --once                       （印一行就結束；doctest 用它證明真的記得到）
// 取不到程序表 → 那一行照實寫「取不到」，不寫成 0（§5.13）。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const WORKER_RX = /^(node|python|python3|py)(\.exe)?$/i;
export const BROWSER_RX = /^(chrome|chrome-headless-shell|chromium|msedge|firefox)(\.exe)?$/i;

/** 讀整台機器的程序表：[{ pid, ppid, name, bytes }]。取不到就丟錯。 */
export function processTable() {
  if (process.platform === 'win32') {
    // 建立時間（毫秒）一起取：認子程序要用它擋 PID 重用（見 summarize）
    const out = execFileSync('powershell', ['-NoProfile', '-Command',
      'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,WorkingSetSize,@{n="Created";e={ if ($_.CreationDate) { [DateTimeOffset]::new($_.CreationDate).ToUnixTimeMilliseconds() } else { $null } }} | ConvertTo-Json -Compress'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
    const rows = JSON.parse(out);
    return (Array.isArray(rows) ? rows : [rows]).map((r) => ({ pid: r.ProcessId, ppid: r.ParentProcessId, name: String(r.Name ?? ''), bytes: Number(r.WorkingSetSize ?? 0), created: Number.isFinite(Number(r.Created)) && r.Created !== null ? Number(r.Created) : null }));
  }
  const now = Date.now();
  const out = execFileSync('ps', ['-eo', 'pid=,ppid=,rss=,etimes=,comm='], { encoding: 'utf8' });
  return out.split('\n').filter((l) => l.trim()).map((l) => {
    const [pid, ppid, rss, etimes, ...name] = l.trim().split(/\s+/);
    return { pid: Number(pid), ppid: Number(ppid), name: path.basename(name.join(' ')), bytes: Number(rss) * 1024, created: Number.isFinite(Number(etimes)) ? now - Number(etimes) * 1000 : null };
  });
}

/**
 * 純函式：從程序表算出 root 底下的工作程序數與記憶體。
 * @returns { workers, bytes, descendants, names: [算進工作程序的名稱] }
 */
export function summarize(rows, rootPid, selfPid = null) {
  const kids = new Map();
  for (const r of rows) { if (!kids.has(r.ppid)) kids.set(r.ppid, []); kids.get(r.ppid).push(r); }
  const byPid = new Map(rows.map((r) => [r.pid, r]));
  // PID 重用（2026-10-02，JLPT 把 OneDrive 認成自己的子程序）：Windows 不會改寫「父程序 PID」——父程序早就結束、號碼被新程序拿去，
  // 舊程序就被認成新程序的子程序。認子程序要求「子程序不早於父程序建立」；建立時間任一邊不知道時照舊認（並在 unknownAge 計數）。
  const olderThanParent = (child, parent) => child.created !== null && child.created !== undefined && parent?.created !== null && parent?.created !== undefined && child.created < parent.created;
  const out = []; const stack = [...(kids.get(rootPid) ?? [])];
  const seen = new Set(); let reused = 0; let unknownAge = 0;
  while (stack.length) {
    const r = stack.pop();
    if (seen.has(r.pid) || r.pid === rootPid) continue;
    seen.add(r.pid);
    if (selfPid !== null && r.pid === selfPid) continue;                 // 記錄工具自己與它的子程序不算
    const parent = byPid.get(r.ppid);
    if (olderThanParent(r, parent)) { reused += 1; continue; }            // 比父程序還早建立：不是它的子程序（PID 重用），連同它的子孫都不算
    if (r.created === null || r.created === undefined || parent?.created === null || parent?.created === undefined) unknownAge += 1;
    out.push(r);
    stack.push(...(kids.get(r.pid) ?? []));
  }
  const names = [];
  for (const r of out) {
    const parent = byPid.get(r.ppid);
    if (WORKER_RX.test(r.name)) names.push(r.name);
    else if (BROWSER_RX.test(r.name) && !(parent && BROWSER_RX.test(parent.name))) names.push(r.name);
  }
  return { workers: names.length, bytes: out.reduce((s, r) => s + (Number.isFinite(r.bytes) ? r.bytes : 0), 0), descendants: out.length, names, reused, unknownAge };
}

const mb = (b) => Math.round(b / 1048576);
export function lineOf(now, s, freeBytes) {
  const t = new Date(now.getTime() + 8 * 3600000).toISOString().replace('T', ' ').slice(0, 19);
  return s ? `${t}\t工作程序 ${s.workers}\t合計記憶體 ${mb(s.bytes)} MB\t系統可用 ${mb(freeBytes)} MB\t（全部程序 ${s.descendants} 個；PID 重用排除 ${s.reused ?? 0}、建立時間不明 ${s.unknownAge ?? 0}）`
    : `${t}\t取不到程序表\t系統可用 ${mb(freeBytes)} MB`;
}

/** 讀一份紀錄檔的峰值：{ lines, peakWorkers, peakMB, minFreeMB, unreadable }（lines＝有數字的行數） */
export function peakOf(text) {
  let lines = 0; let peakWorkers = 0; let peakMB = 0; let minFreeMB = Infinity; let unreadable = 0;
  for (const l of String(text).split('\n')) {
    const w = /工作程序 (\d+)\t合計記憶體 (\d+) MB\t系統可用 (\d+) MB/.exec(l);
    if (w) { lines += 1; peakWorkers = Math.max(peakWorkers, Number(w[1])); peakMB = Math.max(peakMB, Number(w[2])); minFreeMB = Math.min(minFreeMB, Number(w[3])); }
    else if (l.includes('取不到程序表')) unreadable += 1;
  }
  return { lines, peakWorkers, peakMB, minFreeMB: lines ? minFreeMB : null, unreadable };
}

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
function sampleLine(root) {
  let s = null;
  try { s = summarize(processTable(), root, process.pid); } catch { s = null; }
  return lineOf(new Date(), s, os.freemem());
}

async function main() {
  const arg = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
  const root = Number(arg('--root'));
  if (!Number.isInteger(root) || root <= 0) { console.error('✗ 要給 --root <pid>'); process.exit(2); }
  if (process.argv.includes('--once')) { console.log(sampleLine(root)); return; }
  const out = arg('--out');
  if (!out) { console.error('✗ 要給 --out <檔>（或 --once）'); process.exit(2); }
  const interval = Number(arg('--interval') ?? 60) * 1000;
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.appendFileSync(out, `# 資源紀錄：主程式 pid ${root}、每 ${interval / 1000} 秒一行（scripts/reslog.mjs）\n`);
  while (alive(root)) {
    fs.appendFileSync(out, `${sampleLine(root)}\n`);
    await new Promise((r) => setTimeout(r, interval));
  }
  fs.appendFileSync(out, '# 主程式已結束\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(`✗ ${e.message}`); process.exit(1); });
}

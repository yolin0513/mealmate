// 在一個 Job Object 裡跑一個指令（2026-10-08，抄自 StockDiary 2026-10-03 的同名檔；v11.6 §5.19「殺程序不要靠父程序編號往下找子孫」）。
//
//   node scripts/jobrun.mjs <指令> [參數…]        結束碼＝那個指令的結束碼；Job 建不起來回 97（情境未成立，不照跑）
//
// 為什麼：只殺直接開的那一支，它經 Git Bash 開的孫程序會活下來；照父程序編號往下找，中間那一支先結束（detached、分叉）的就找不到。
// Windows 的解法是 Job Object：之後開的子孫自動歸它管、Job 關閉時連帶殺，不看父程序編號。Node 建不了 Job，所以：
//   1. 先開協助程序 scripts/jobhelper.ps1，叫它把**這支（jobrun 自己）**放進一個「關閉時連帶殺、不准脫離」的 Job
//   2. 等它回「JOB-OK」——**放進去了，才開真正的指令**。順序反過來（先開指令、再把它放進 Job）會留下一個看不出來的空檔：
//      指令在被放進去之前開的子孫不在 Job 裡。
//   3. 指令結束 → 這支帶著同一個結束碼結束 → 協助程序的標準輸入被關掉、它結束 → Job 關閉 → 留下來的子孫全部被殺。
// 呼叫端要停它（逾時）時，殺這一支就好。非 Windows：沒有 Job Object，直接跑（照實寫：那邊的漏殺沒有處理）。
// 驗法：node scripts/jobtest.mjs。

import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const [cmd, ...args] = process.argv.slice(2);
if (!cmd) { console.error('用法：node scripts/jobrun.mjs <指令> [參數…]'); process.exit(2); }

function runIt() {
  // MM_JOBRUN：讓被包的那一支看得出自己是經 jobrun 開的（2026-10-08；doctest 用它確認執行器真的經 jobrun 跑測試）。只是標記，不改任何行為
  const child = spawn(cmd, args, { stdio: 'inherit', env: { ...process.env, MM_JOBRUN: String(process.pid) } });
  child.on('error', (e) => { console.error(`jobrun：開不了 ${cmd}：${e.message}`); process.exit(127); });
  child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
}

if (process.platform !== 'win32') runIt();
else {
  const helper = spawn('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(HERE, 'jobhelper.ps1'), '-TargetPid', String(process.pid)],
    { stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '';
  let started = false;
  // 行首用「⊘ 情境未成立」（runkind 的 NO_SCENARIO_MARK）：執行器把它分到情境未成立、不算數，不會被當成紅
  const fail = (why) => { if (!started) { console.error(`⊘ 情境未成立：jobrun 的 Job 建不起來（${why}）——不照跑`); process.exit(97); } };
  helper.stdout.on('data', (b) => {
    out += b.toString();
    if (!started && /^JOB-OK \d+/m.test(out)) { started = true; runIt(); }   // 放進 Job 了，才開
    else if (/^JOB-FAIL /m.test(out)) fail(out.trim());
  });
  helper.on('exit', (code) => fail(`協助程序結束，回傳 ${code}：${out.trim().slice(0, 200)}`));
  helper.on('error', (e) => fail(e.message));
  setTimeout(() => fail('等了 30 秒還沒回 JOB-OK'), 30000).unref();
}

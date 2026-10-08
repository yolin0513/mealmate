// Job Object（scripts/jobrun.mjs＋jobhelper.ps1）的測試（2026-10-08，抄自 StockDiary 2026-10-03 的 jobtest，加一節「停掉父程序」）。
//
// 每一種漏殺各一個情境，**各帶一個不經 jobrun 的對照**（證明那個情境真的會漏，不然「經 jobrun 殺完 0 個」可能只是情境沒造出來）；
// 殺之前先確認都活著（前置）。另外：結束碼照傳、經 cmd.exe 開、正常結束時留下的子孫也被收掉、停掉的是 jobrun 的父程序也收得掉。
// 會被殺的那些程序（sleep、node -e 的計時器）都不接任何輸出管道（stdio: 'ignore'）——收掉它們的只能是 Job，
// 不會是「上層一死、管道斷了它自己退出」（2026-10-02 那次子孫跟著不見，分不出是哪一個原因）。
// 數程序用帶標記的指令列（標記在原始碼裡拆開拼：外層的指令列不會含完整的標記），查詢式自己有對照。
// 只在 Windows 跑；別的平台照實寫「沒驗」。不在 npm test 的鏈裡（約 1–2 分鐘、會開好幾支程序），單獨跑：node scripts/jobtest.mjs。

import { spawn, spawnSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ok, eq, section, done, note } from './tap.mjs';
import { resolveBash } from './gatemutants.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const JOBRUN = path.join(ROOT, 'scripts', 'jobrun.mjs');
const N = process.execPath;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ps = (cmd) => execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', cmd], { encoding: 'utf8' }).trim();
const count = (name, like) => Number(ps(`@(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq '${name}' -and $_.CommandLine -like '${like}' }).Count`));
const sweep = (name, like) => ps(`Get-CimInstance Win32_Process | Where-Object { $_.Name -eq '${name}' -and $_.CommandLine -like '${like}' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`);
/**
 * 那幾支 sleep 的 PID（2026-10-08，Dispatch：「空清單」跟「真的 0 支」在輸出上長得一樣）：同一次查詢裡也查 jobtest 自己——
 * 自己都查不到＝查詢壞了（不是 0 支），丟例外讓這支崩潰（崩潰列為不算數，不會被當成「殺乾淨了」）。回排序過的 PID 陣列。
 */
const sleepPids = (secs) => {
  const raw = ps(`$all = @(Get-CimInstance Win32_Process); $self = @($all | Where-Object { $_.ProcessId -eq ${process.pid} }).Count; $p = @($all | Where-Object { $_.Name -eq 'sleep.exe' -and $_.CommandLine -like '*sleep* ${secs}*' } | ForEach-Object { $_.ProcessId }); "$self|$($p -join ',')"`);
  const [self, list] = raw.split('|');
  if (self !== '1') throw new Error(`查程序表查不到 jobtest 自己（${raw}）——查詢壞了，不是 0 支`);
  return (list ?? '').split(',').filter(Boolean).map(Number).sort((a, b) => a - b);
};
const sweepSleep = (secs) => ps(`Get-CimInstance Win32_Process | Where-Object { ($_.Name -eq 'sleep.exe' -or $_.Name -eq 'bash.exe') -and $_.CommandLine -like '*sleep* ${secs}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`);
const tagOf = (k) => `MMJ${k}${process.pid}${Date.now() % 100000}`;

if (process.platform !== 'win32') {
  note('Job Object 只在 Windows：這個平台沒驗（jobrun 直接跑指令，漏殺沒有處理）');
  done('jobtest');
  process.exit(0);
}

section('數程序的查詢式（對照）');
{
  const t = tagOf('C');
  const outer = `require('child_process').spawn(process.execPath, ['-e', 'setTimeout(()=>{}, 8000)', ${JSON.stringify(t)} + '-IN'], { stdio: 'ignore' }); setTimeout(()=>{}, 8000);`;
  const p = spawn(N, ['-e', outer, `${t}-OUT`], { stdio: 'ignore' });
  await wait(1500);
  eq([count('node.exe', `* ${t}-OUT`), count('node.exe', `* ${t}-IN`)], [1, 1], 'Job・查詢式（對照）：外層、內層各數到 1 個（外層的指令列不會被算成內層）');
  p.kill(); sweep('node.exe', `*${t}*`);
}

section('結束碼照傳');
{
  const r = spawnSync(N, [JOBRUN, N, '-e', 'console.log("job-hi"); process.exit(7)'], { encoding: 'utf8' });
  ok(r.status === 7 && r.stdout.includes('job-hi'), 'Job・結束碼照傳：指令回 7，jobrun 也回 7、輸出照樣傳出來', `回傳 ${r.status}；${String(r.stderr).slice(0, 200)}`);
}

const rb = resolveBash();
ok(!!rb.bash, `（前提）Job・解得出 Git Bash（${rb.bash ? path.basename(rb.bash) : rb.problem}）`);
const BASH = rb.bash;
/** 漏的一：直接那一支經 Git Bash 開 2 個 sleep；用 handle 殺最外層（執行器逾時的殺法） */
async function sleepCase(viaJob) {
  const secs = 6000 + Math.floor(Math.random() * 900) + (viaJob ? 0 : 1000);
  const prog = `require('child_process').spawn(${JSON.stringify(BASH)}, ['-c', 'sleep ${secs} & sleep ${secs} & wait'], { stdio: 'ignore' }); setTimeout(()=>{}, 20000);`;
  const p = spawn(N, viaJob ? [JOBRUN, N, '-e', prog] : ['-e', prog], { stdio: 'ignore' });
  let before = 0;
  for (let i = 0; i < 20 && before < 2; i++) { await wait(500); before = count('sleep.exe', `*sleep* ${secs}*`); }
  p.kill();
  await wait(1000);
  const after = count('sleep.exe', `*sleep* ${secs}*`);
  if (after) sweepSleep(secs);
  return { before, after };
}
section('漏的一：經 Git Bash 開的孫程序（執行器逾時只殺直接那一支）');
{
  const c = await sleepCase(false);
  ok(c.before === 2 && c.after === 2, 'Job・Git Bash（對照）：不經 jobrun，殺掉直接那一支之後 2 個 sleep 還活著（這個情境真的會漏）', JSON.stringify(c));
  const j = await sleepCase(true);
  ok(j.before === 2, '（前提）Job・Git Bash：經 jobrun 時，殺之前 2 個 sleep 都活著', JSON.stringify(j));
  ok(j.after === 0, 'Job・Git Bash：經 jobrun，殺掉最外層之後 sleep 一個都不剩', JSON.stringify(j));
}

/** 漏的二：根 → 中間（detached 開目標、自己結束）→ 目標；殺最外層 */
async function detachedCase(viaJob) {
  const t = tagOf(viaJob ? 'J' : 'N');
  const mid = `const c = require('child_process').spawn(process.execPath, ['-e', 'setTimeout(()=>{}, 20000)', ${JSON.stringify(t)} + '-T'], { stdio: 'ignore', detached: true }); c.unref(); setTimeout(() => process.exit(0), 300);`;
  const root = `require('child_process').spawn(process.execPath, ['-e', ${JSON.stringify(mid)}], { stdio: 'ignore' }); setTimeout(()=>{}, 20000);`;
  const p = spawn(N, viaJob ? [JOBRUN, N, '-e', root] : ['-e', root], { stdio: 'ignore' });
  let before = 0;
  for (let i = 0; i < 20 && before < 1; i++) { await wait(500); before = count('node.exe', `* ${t}-T`); }
  await wait(500);   // 讓中間那一支確實先結束
  p.kill();
  await wait(1000);
  const after = count('node.exe', `* ${t}-T`);
  if (after) sweep('node.exe', `*${t}*`);
  return { before, after };
}
section('漏的二：中間那一支用 detached 開了目標、自己先結束（照父程序編號找不到）');
{
  const c = await detachedCase(false);
  ok(c.before === 1 && c.after === 1, 'Job・detached（對照）：不經 jobrun，殺掉最外層之後目標還活著（這個情境真的會漏）', JSON.stringify(c));
  const j = await detachedCase(true);
  ok(j.before === 1, '（前提）Job・detached：經 jobrun 時，殺之前目標活著', JSON.stringify(j));
  ok(j.after === 0, 'Job・detached：經 jobrun，殺掉最外層之後目標不剩（不准脫離 Job）', JSON.stringify(j));
}

section('經 cmd.exe 開（npx 那一類的形狀）');
{
  const t = tagOf('W');
  const sleeperFile = path.join(ROOT, '.logs', `jobtest-sleeper-${process.pid}.mjs`);
  fs.mkdirSync(path.dirname(sleeperFile), { recursive: true });
  fs.writeFileSync(sleeperFile, 'setTimeout(() => {}, 20000);\n');
  const p = spawn(N, [JOBRUN, 'cmd.exe', '/d', '/s', '/c', `node ${sleeperFile} ${t}-W`], { stdio: 'ignore' });
  let before = 0;
  for (let i = 0; i < 20 && before < 1; i++) { await wait(500); before = count('node.exe', `* ${t}-W`); }
  ok(before === 1, '（前提）Job・cmd.exe：殺之前 cmd 開的那支 node 活著', JSON.stringify({ before }));
  p.kill();
  await wait(1000);
  const after = count('node.exe', `* ${t}-W`);
  if (after) sweep('node.exe', `*${t}*`);
  fs.rmSync(sleeperFile, { force: true });
  ok(after === 0, 'Job・cmd.exe：經 jobrun 開 cmd.exe、它再開 node，殺掉最外層之後 node 不剩', JSON.stringify({ before, after }));
}

section('正常結束時，留下來的子孫也被收掉');
{
  const secs = 6000 + Math.floor(Math.random() * 900) + 2000;
  const prog = `require('child_process').spawn(${JSON.stringify(BASH)}, ['-c', 'sleep ${secs} & sleep ${secs} & wait'], { stdio: 'ignore', detached: true }).unref(); setTimeout(() => process.exit(0), 2500);`;
  const r = spawnSync(N, [JOBRUN, N, '-e', prog], { encoding: 'utf8', timeout: 30000 });
  await wait(1500);
  const after = count('sleep.exe', `*sleep* ${secs}*`);
  if (after) sweepSleep(secs);
  ok(r.status === 0 && after === 0, 'Job・正常結束：指令以 0 結束，它留下的 sleep 也一起被收掉', JSON.stringify({ status: r.status, after }));
}

// 2026-10-08（Dispatch：停掉上層時子孫有沒有被收掉，不能只靠推論）：停的是 jobrun 的**父程序**（執行器被外部監看停掉那種），
// 不是 jobrun 本身。父程序經 jobrun 開測試、測試經 Git Bash 開 2 個 sleep；sleep 不接任何管道。對照組：同一個父程序直接開測試（不經 jobrun）
async function parentCase(viaJob) {
  const secs = 6000 + Math.floor(Math.random() * 900) + (viaJob ? 3000 : 4000);
  const test = `require('child_process').spawn(${JSON.stringify(BASH)}, ['-c', 'sleep ${secs} & sleep ${secs} & wait'], { stdio: 'ignore' }); setTimeout(()=>{}, 20000);`;
  const childArgs = viaJob ? [JOBRUN, N, '-e', test] : ['-e', test];
  const parent = `require('child_process').spawn(process.execPath, ${JSON.stringify(childArgs)}, { stdio: 'ignore' }); setTimeout(()=>{}, 20000);`;
  const p = spawn(N, ['-e', parent], { stdio: 'ignore' });
  let before = [];
  for (let i = 0; i < 20 && before.length < 2; i++) { await wait(500); before = sleepPids(secs); }
  p.kill();
  await wait(1500);
  const after = sleepPids(secs);
  if (after.length) sweepSleep(secs);
  // 停之後還在的，是不是就是停之前那一批（PID 對得上）——對照組要「同一批 2 支都還在」，經 jobrun 要「那一批一支都不在」
  return { before, after, same: after.length === before.length && after.every((x, i) => x === before[i]), gone: before.length > 0 && before.every((x) => !after.includes(x)) };
}
section('停掉的是 jobrun 的父程序（例：執行器被外部監看停掉）');
{
  const c = await parentCase(false);
  note(`停父程序（對照，不經 jobrun）：停之前 sleep PID ${c.before.join('、') || '（無）'}；停之後 ${c.after.join('、') || '（無）'}`);
  ok(c.before.length === 2 && c.same, 'Job・停父程序（對照）：不經 jobrun，停掉父程序之後還活著的正是停之前那 2 支 sleep（PID 對得上——這個情境真的會漏）', JSON.stringify(c));
  const j = await parentCase(true);
  note(`停父程序（經 jobrun）：停之前 sleep PID ${j.before.join('、') || '（無）'}；停之後 ${j.after.join('、') || '（無）'}（同一次查詢看得到 jobtest 自己 PID ${process.pid}）`);
  ok(j.before.length === 2, '（前提）Job・停父程序：經 jobrun 時，停之前 2 個 sleep 都活著', JSON.stringify(j));
  ok(j.after.length === 0 && j.gone, 'Job・停父程序：經 jobrun，停掉 jobrun 的父程序之後，停之前那 2 支 sleep 的 PID 一支都不在（查詢同時看得到 jobtest 自己，不是查詢壞了；sleep 不接管道——收掉它們的是 Job）', JSON.stringify(j));
}

// 2026-10-08：接到執行器上——runkind.runProgram 的 inJob。測試逾時被殺（執行器的時限）時，測試經 Git Bash 開的 sleep 要一起被收掉。
// runProgram 是同步的，殺之前看不到 sleep：改由 bash 在開完兩支 sleep 之後寫一個記號檔，事後確認它在（＝情境真的成立了）。
// 對照組：同一個程式不經 Job（inJob: false），逾時之後那 2 支 sleep 還活著
section('接到執行器：runProgram 逾時殺測試時，測試的子孫一起被收掉');
{
  const { runProgram } = await import('./runkind.mjs');
  const runCase = async (inJob) => {
    const secs = 6000 + Math.floor(Math.random() * 900) + (inJob ? 5000 : 6000);
    const mark = path.join(ROOT, '.logs', `jobtest-started-${process.pid}-${inJob ? 'j' : 'n'}.txt`).replace(/\\/g, '/');
    fs.rmSync(mark, { force: true });
    const prog = `require('child_process').spawn(${JSON.stringify(BASH)}, ['-c', 'sleep ${secs} & sleep ${secs} & echo started > "${mark}"; wait'], { stdio: 'ignore' }); setTimeout(()=>{}, 60000);`;
    const r = runProgram(['-e', prog], { timeoutMs: 8000, inJob });
    await wait(1500);
    const started = fs.existsSync(mark);
    fs.rmSync(mark, { force: true });
    const after = sleepPids(secs);
    if (after.length) sweepSleep(secs);
    return { kind: r.kind, started, after };
  };
  const c = await runCase(false);
  note(`runProgram 逾時（對照，不經 Job）：結束方式 ${c.kind}；sleep 開起來了 ${c.started}；逾時之後還活著的 sleep PID ${c.after.join('、') || '（無）'}`);
  ok(c.kind === 'timeout' && c.started && c.after.length === 2, 'Job・執行器（對照）：不經 Job，測試逾時被殺之後它開的 2 支 sleep 還活著（這個情境真的會漏）', JSON.stringify(c));
  const j = await runCase(true);
  note(`runProgram 逾時（inJob）：結束方式 ${j.kind}；sleep 開起來了 ${j.started}；逾時之後還活著的 sleep PID ${j.after.join('、') || '（無）'}（同一次查詢看得到 jobtest 自己）`);
  ok(j.started, '（前提）Job・執行器：經 Job 那一次，2 支 sleep 真的開起來了（bash 留下記號檔）', JSON.stringify(j));
  ok(j.kind === 'timeout' && j.after.length === 0, 'Job・執行器：runProgram 的 inJob——測試逾時被殺之後，它經 Git Bash 開的 sleep 一支都不剩', JSON.stringify(j));
}

// 2026-10-08：逐一計數與結束核對（v11 §5.19「峰值用逐一計數」；jobhelper 的完成埠＋jobrun 結束前要的那一行結算）。
// 真相來源是我寫死的工作量（同時開 2 支／依序開 2 支／留 1 支在背景），計數器是另一個來源——兩個獨立，斷言才紅得起來
section('逐一計數與結束核對：jobrun 結束前印一行 Job 結算');
{
  const { parseJobSum } = await import('./runkind.mjs');
  const viaJob = (script) => {
    const r = spawnSync(N, [JOBRUN, BASH, '-c', script], { encoding: 'utf8', timeout: 60000 });
    return { code: r.status, sum: parseJobSum(r.stdout), raw: (r.stdout ?? '').split('\n').find((l) => l.startsWith('JOB-SUM')) ?? '（沒有結算行）' };
  };
  const conc = viaJob('sleep 2 & sleep 2 & wait');
  const seq = viaJob('sleep 1; sleep 1');
  note('下面結算行的 peakmix／left 是程序名：名字只當參考、總數才準——名字是程序進 Job 那一刻的，Git Bash 先分叉出 bash 再換成目標，sleep 常被記成 bash');
  note(`同時開 2 支：${conc.raw}`);
  note(`依序開 2 支：${seq.raw}`);
  ok(conc.sum.ok && seq.sum.ok, 'Job・逐一計數：兩次都有結算行、讀得懂', JSON.stringify({ conc, seq }));
  ok(conc.sum.ok && conc.sum.peak >= 4, `Job・逐一計數：同時開 2 支 sleep 的峰值至少 4（jobrun、bash、2 支 sleep）：${conc.sum.peak}`);
  // 「同時開的峰值大於依序開的」分不出「只加不減」（那樣峰值＝累計開過的，6 照樣大於 5）——改成：依序開的工作量不可能全部同時存在，
  // 所以峰值必須小於開過的總數；只加不減時兩者相等
  ok(seq.sum.ok && seq.sum.peak < seq.sum.started, `Job・逐一計數：依序開 2 支時，峰值（${seq.sum.peak}）小於開過的總數（${seq.sum.started}）——峰值是同時存在的，不是累計開過的`);
  ok(conc.sum.ok && seq.sum.ok && conc.sum.leftOthers === 0 && seq.sum.leftOthers === 0,
    `Job・結束核對：正常結束時，留在 Job 裡的（不含 jobrun 自己）剛好 0（同時 ${conc.sum.leftOthers}、依序 ${seq.sum.leftOthers}）`);
  // 留一支在背景：bash 先結束，sleep 還在 Job 裡——結算要數到它；jobrun 結束、Job 關閉之後它要被收掉
  const secs = 7000 + Math.floor(Math.random() * 900);
  const left = viaJob(`sleep ${secs} & exit 0`);
  note(`留 1 支在背景：${left.raw}`);
  await wait(1500);
  const after = sleepPids(secs);
  if (after.length) sweepSleep(secs);
  ok(left.sum.ok && left.sum.leftOthers >= 1, `Job・結束核對：bash 先結束、sleep 留在背景 → 結算數到留下來的至少 1 支：${left.sum.leftOthers}（${left.sum.left}）`);
  ok(after.length === 0, `Job・結束核對：結算之後 Job 關閉，留下來的那支 sleep 也被收掉（還活著 ${after.length} 支）`);
}

done('jobtest');

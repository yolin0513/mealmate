// 外部記憶體監看（scripts/memwatch.mjs）的測試（2026-10-08；原本在 .logs/，Dispatch 決定搬進版控）。
//
//   綁執行器：假外殼開出假執行器、停掉外殼之後，監看照樣接上執行器、看到查滿次數（舊版綁外殼，外殼一停就收手——這個缺陷改成突變）
//   觸發：門檻設成極高 → 回 3、停掉的是當下的執行器，停完它不在
//   結束時機：執行器自己結束 → 連續 grace 輪找不到就結束（不是查滿次數才結束）
//   瀏覽器：假執行器 → 假測試 → 瀏覽器，全用相對路徑開（三支指令列都不含 MealMate 也不含 mm-）→ 監看數到瀏覽器 1。
//     只看指令列一支都認不到，靠的是「從執行器往下走」（舊版按指令列認——改成突變；不往下走——也是一條突變）。
//     第一版這一節讓本測試自己開瀏覽器，基準就紅了：本測試用相對路徑開、指令列沒有 MealMate，它開的瀏覽器被漏掉——這是監看真的缺陷，不是測試寫錯
//
// 安全：假執行器叫 scripts/fakerunner.mjs，監看用 --runner 指向它。**不能用預設的 scripts/mutationtest.mjs**——突變執行器跑這支測試時，
// 真的執行器指令列就是那個相對路徑，「觸發」那一節會把它停掉。
// 本 repo 同時最多 4 個工作程序：瀏覽器那一節最多——假執行器、假測試、瀏覽器、監看（本測試是啟動它們的主程式）。
// 只在 Windows 有意義；不在 npm test 的鏈裡（約 1 分鐘、開瀏覽器與好幾支程序），單獨跑：node scripts/memwatchtest.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ok, section, done, note } from './tap.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const WATCH = path.join(ROOT, 'scripts', 'memwatch.mjs');
const RUNNER = 'scripts/fakerunner.mjs';
const ps = (cmd) => execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', cmd], { encoding: 'utf8', maxBuffer: 1 << 26 });
// 一次取全部程序；同一次查詢裡也要查得到本測試自己，查不到＝查詢壞了，丟例外（不當成「沒有程序」）
const procs = () => {
  const all = [].concat(JSON.parse(ps('Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine,@{n="Created";e={$_.CreationDate.ToString("HH:mm:ss")}} | ConvertTo-Json -Compress')));
  if (!all.some((x) => x.ProcessId === process.pid)) throw new Error('程序查詢查不到本測試自己——查詢壞了');
  return all;
};
const alive = (pid) => procs().some((x) => x.ProcessId === pid);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms, label) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await sleep(500); } throw new Error(`等不到：${label}`); };
const kill = (pid) => { try { execFileSync('taskkill', ['/PID', String(pid), '/F'], { stdio: 'ignore' }); } catch { /* 已經不在：要緊的地方用 alive() 驗，不靠這裡 */ } };

if (process.platform !== 'win32') {
  note('不是 Windows：監看靠 Win32_Process，沒驗');
  done('memwatchtest');
  process.exit(0);
}
// 整支放進 Job（2026-10-08，Dispatch 准）：被執行器跑時它本來就在 Job 裡（MM_JOBRUN 有值）；單獨跑時自己經 jobrun 重新開一次——
// 中途出錯、有程序沒記到時，測試結束、Job 關閉也會把它們收掉。收尾本身不靠這一道（見下面 finally）
if (!process.env.MM_JOBRUN) {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'jobrun.mjs'), process.execPath, fileURLToPath(import.meta.url), ...process.argv.slice(2)], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-mwtest-'));
const runWatch = (extra, logName) => new Promise((resolve) => {
  const log = path.join(tmp, logName);
  fs.rmSync(log, { force: true });
  const p = spawn(process.execPath, [WATCH, '--interval', '1', '--runner', RUNNER, '--log', log, ...extra], { cwd: ROOT, stdio: 'ignore' });
  p.on('exit', (code) => resolve({ code, log: fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '' }));
});
// 這次開的每一支程序：PID → 建立時間（收尾逐一停、逐一確認不在；建立時間防 PID 被重用時誤判）
const leftovers = new Map();
const track = (pid) => { if (!pid || leftovers.has(pid)) return; const x = procs().find((p) => p.ProcessId === pid); leftovers.set(pid, x?.Created ?? null); };
try {
  fs.mkdirSync(path.join(tmp, 'scripts'));
  // 假執行器：睡 N 秒；第二個參數是 browser 時，另外用相對路徑開假測試（假測試開瀏覽器）
  fs.writeFileSync(path.join(tmp, RUNNER), "import { spawn } from 'node:child_process';\nif (process.argv[3] === 'browser') spawn(process.execPath, ['scripts/faketest.mjs', process.argv[4]], { stdio: 'ignore' });\nsetTimeout(() => {}, Number(process.argv[2] ?? 90) * 1000);\n");
  fs.writeFileSync(path.join(tmp, 'shell.mjs'), `import { spawn } from 'node:child_process';\nconst c = spawn(process.execPath, [${JSON.stringify(RUNNER)}, process.argv[2] ?? '90'], { cwd: process.argv[3], detached: true, stdio: 'ignore' });\nc.unref();\nsetTimeout(() => {}, 120000);\n`);
  const startShell = async (secs) => {
    const sh = spawn(process.execPath, [path.join(tmp, 'shell.mjs'), String(secs), tmp], { stdio: 'ignore' });
    track(sh.pid);
    const runner = await waitFor(() => procs().find((x) => x.Name === 'node.exe' && x.ParentProcessId === sh.pid && (x.CommandLine ?? '').includes(RUNNER)), 15000, '假執行器開起來');
    track(runner.ProcessId);
    return { sh, runner };
  };

  section('綁當下的執行器，不綁外殼');
  {
    const { sh, runner } = await startShell(90);
    kill(sh.pid);
    ok(!alive(sh.pid) && alive(runner.ProcessId), `（前提）監看・綁執行器：外殼 ${sh.pid} 停了、假執行器 ${runner.ProcessId} 還在跑`);
    const r = await runWatch(['--threshold', '0', '--count', '2', '--max-checks', '6'], 'bind.log');
    ok(r.log.includes(`接上執行器 node.exe(${runner.ProcessId}`) && r.log.includes('查了 6 次') && !r.log.includes('找不到執行器'),
      `監看・綁執行器：外殼已經停了，照樣接上執行器 ${runner.ProcessId}、看到查滿 6 次（回 ${r.code}）`);
    section('觸發時停的是當下的執行器');
    const r2 = await runWatch(['--threshold', '999999999', '--count', '2', '--max-checks', '20'], 'trigger.log');
    ok(r2.code === 3 && r2.log.includes(`已停 node.exe(${runner.ProcessId})`) && !alive(runner.ProcessId),
      `監看・觸發：門檻極高 → 回 ${r2.code}（要 3）、停掉執行器 ${runner.ProcessId}、停完它${alive(runner.ProcessId) ? '還在' : '不在'}`);
    kill(runner.ProcessId);
  }

  section('執行器自己結束 → 連續幾輪找不到就結束');
  {
    const { sh, runner } = await startShell(5);
    kill(sh.pid);
    // 上限 15：正常約 6–8 輪就因找不到執行器結束；「不結束」的突變在 15 輪（約 35 秒）查滿收手、紅在這一條，不靠時限殺（耗時暴增量到的只是變慢）
    const r = await runWatch(['--threshold', '0', '--count', '2', '--max-checks', '15', '--grace', '3'], 'grace.log');
    ok(r.code === 0 && r.log.includes(`接上執行器 node.exe(${runner.ProcessId}`) && r.log.includes('連續 3 輪找不到執行器，監看結束') && !r.log.includes('查了 15 次'),
      `監看・結束時機：執行器結束後連續 3 輪找不到 → 結束（回 ${r.code}）`);
  }

  section('認得瀏覽器（從執行器往下走：執行器 → 測試 → 瀏覽器，全用相對路徑開）');
  {
    // 跟真的一樣：執行器開測試、測試開瀏覽器。全部用相對路徑、參數也是相對的——指令列裡沒有 MealMate、也沒有 mm-，
    // 只看指令列一支都認不到；認得到只可能是從執行器往下走（基準第一次就是這樣紅的：本測試自己用相對路徑開，它開的瀏覽器被漏掉）
    const pup = pathToFileURL(path.join(ROOT, 'node_modules/puppeteer/lib/esm/puppeteer/puppeteer.js')).href;
    fs.writeFileSync(path.join(tmp, 'scripts/faketest.mjs'), `import puppeteer from ${JSON.stringify(pup)};\nimport fs from 'node:fs';\nconst b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });\nfs.writeFileSync(process.argv[2], String(b.process().pid));\nawait new Promise((r) => setTimeout(r, 40000));\nawait b.close();\n`);
    const runner = spawn(process.execPath, [RUNNER, '90', 'browser', 'browser.pid'], { cwd: tmp, stdio: 'ignore' });
    track(runner.pid);
    const ready = path.join(tmp, 'browser.pid');
    const bpid = Number(await waitFor(() => fs.existsSync(ready) && fs.readFileSync(ready, 'utf8'), 30000, '假測試的瀏覽器開起來'));
    track(bpid);
    const all = procs();
    const bp = all.find((x) => x.ProcessId === bpid);
    const ft = bp && all.find((x) => x.ProcessId === bp.ParentProcessId);
    if (ft) track(ft.ProcessId);
    const rn = all.find((x) => x.ProcessId === runner.pid);
    const plain = (x) => !!x && !(x.CommandLine ?? '').includes('MealMate') && !(x.CommandLine ?? '').includes('mm-');
    ok(!!ft && ft.Name === 'node.exe' && ft.ParentProcessId === runner.pid && plain(rn) && plain(ft) && plain(bp),
      `（前提）監看・瀏覽器：鏈是執行器 ${runner.pid} → 測試 ${ft?.ProcessId ?? '？'} → 瀏覽器 ${bpid}，三支的指令列都不含 MealMate 也不含 mm-（只看指令列認不到）`);
    const r = await runWatch(['--threshold', '0', '--count', '2', '--max-checks', '2', '--count-workers'], 'browser.log');
    const n = /＋瀏覽器 (\d+)/.exec(r.log)?.[1];
    ok(n === '1', `監看・瀏覽器：開著一個，監看數到 ${n ?? '（沒有這一行）'} 個`);
    kill(bpid); if (ft) kill(ft.ProcessId); kill(runner.pid);
  }
  // 收尾探針：正常路徑上每一支都在各自那一節停掉了，收尾那一步沒東西可停——拿掉它也照樣綠、等於沒驗到。
  // 這一支只睡覺、刻意不在中途停，只能靠收尾停掉（放在最後：不讓同時開著的超過 4 個）
  const probe = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 120000)'], { stdio: 'ignore' });
  track(probe.pid);
} catch (e) {
  ok(false, `監看・測試本身出錯：${e.message}`);
} finally {
  // 逐一停（只停這次開的、PID 記在 leftovers 裡的），**不用 taskkill /T**：靠父程序編號往下找子孫，殺不到經 Git Bash 開的——
  // 2026-10-08 照 v11.6 的驗法實測（.logs/taskkill-tree-probe.mjs）：node 經 Git Bash 開 2 支 sleep，taskkill /T /F 停掉 node 之後 2 支照樣活著。
  // 原本的收尾斷言只找「指令列含暫存資料夾名稱」的程序——假執行器、假測試都用相對路徑開，指令列裡沒有那個名稱，漏了也看不見
  //（量測跟被量共用了同一個設計：為了讓監看只能靠往下走認它們，指令列刻意不含名稱）。改成逐支照 PID＋建立時間確認
  for (const pid of leftovers.keys()) kill(pid);
  await sleep(1500);
  const now = procs();
  const still = [...leftovers].filter(([pid, created]) => now.some((x) => x.ProcessId === pid && (created === null || x.Created === created)));
  ok(leftovers.size >= 6 && still.length === 0, `監看・收尾：這次開的 ${leftovers.size} 支程序（外殼、假執行器、假測試、瀏覽器、收尾探針）都已不在——還在的 ${still.length} 支${still.length ? `：${still.map(([p]) => p).join('、')}` : ''}`);
  fs.rmSync(tmp, { recursive: true, force: true });
}
done('memwatchtest');

// 外部記憶體監看（2026-10-02 起放在 .logs/；2026-10-08 第二版、搬進 scripts/ 進版控——Dispatch：只存在一台機器上被忽略的目錄裡的防線，
// 重新 clone 就靜默消失，消失的樣子跟「本來就沒裝」一模一樣）。長跑時另開一個視窗掛上去：執行（讀）它不算改 scripts/。
// 測試：node scripts/memwatchtest.mjs（刻意不在 npm test 鏈裡，見 sincefull.mjs 的 CHAIN_EXEMPT）。
// 每 interval 秒讀一次系統可用記憶體；連續 count 次低於 threshold MB，就停掉「當下在跑的執行器」（不碰執行器底下的子孫——
// 執行器的測試都經 jobrun 開，執行器一停，jobrun 看到父程序不在就收掉整個 Job）。停之前逐支確認：還在、名稱對、建立時間對（防 PID 重用）。
//
// 第二版改的兩件（10-02 正式那場撞到的）：
//   一、綁「當下在跑的那一支」，不綁外殼：每一輪重新找指令列是「node.exe 相對路徑 <runner>」的程序（預設 scripts/mutationtest.mjs；
//       doctest 裡的探針用暫存資料夾的絕對路徑，不會對到），身分＝PID＋名稱＋建立時間。外殼停了、執行器還在，照樣看著；
//       外殼開了新的一段（新的執行器），下一輪就接上。連續 grace 輪都找不到執行器才結束。
//   二、認得瀏覽器：puppeteer 開的 chrome.exe 指令列裡沒有 MealMate、也沒有 mm-（2026-10-08 實測；memwatchtest 的「瀏覽器」那一節有前提斷言守著），
//       舊版按指令列認一定認不到。改成：沒有 --type= 的 chrome.exe，父程序是已認定屬於本 repo 的 node，就算一個工作程序。
//
// 用法：node scripts/memwatch.mjs --threshold 2048 --count 3 --interval 5 [--runner scripts/mutationtest.mjs] [--grace 3]
//        [--count-workers] [--max-checks N] --log 檔
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const TH = Number(opt('--threshold', '2048')); const COUNT = Number(opt('--count', '3')); const IV = Number(opt('--interval', '5'));
const MAX = opt('--max-checks', null) === null ? Infinity : Number(opt('--max-checks'));
const GRACE = Number(opt('--grace', '3'));
const RUNNER = opt('--runner', 'scripts/mutationtest.mjs');
const LOG = opt('--log', '.logs/memwatch.log');
const COUNT_WORKERS = args.includes('--count-workers');
for (const [k, v] of Object.entries({ TH, COUNT, IV, GRACE })) if (!Number.isFinite(v)) { console.error(`✗ 參數 ${k} 不是數字`); process.exit(2); }
const now = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(11, 19);
const log = (s) => fs.appendFileSync(LOG, `${now()} ${s}\n`);
const ps = (cmd) => execFileSync('powershell', ['-NoProfile', '-Command', cmd], { encoding: 'utf8', maxBuffer: 1 << 26 });
const freeMB = () => Math.round(Number(ps('(Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory')) / 1024);
// 一次取全部程序：PID、父 PID、名稱、記憶體、建立時間、指令列。取不到或解析不了就丟例外——監看停在這裡，不當成「沒有程序」
const procs = () => [].concat(JSON.parse(ps('Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,WorkingSetSize,CommandLine,@{n="Created";e={$_.CreationDate.ToString("HH:mm:ss")}},@{n="Born";e={$_.CreationDate.ToString("yyyyMMddHHmmss.fff")}} | ConvertTo-Json -Compress')));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = RUNNER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\//g, '[\\\\/]');
const runnerRe = new RegExp(`node(\\.exe)?"? ${esc}( |$)`);
const clean = (c) => (c ?? '').replace(/[A-Za-z]:\\Users\\[^\\]+/g, '~').slice(0, 100);

// 本 repo 的工作程序（不含監看自己）：
//   node.exe——指令列含 MealMate 或暫存的 mm- 資料夾，**或是執行器、或在執行器底下**（從執行器往下走）。
//     往下走是 2026-10-08 補的：用相對路徑開的 node（例：node scripts/xxx.mjs）指令列裡沒有 MealMate，只看指令列認不到
//     （memwatchtest 的基準跑出來的；.logs 那一版的測試把假測試放在 mm- 資料夾裡，剛好被指令列認到，沒抓到）。
//     防 PID 重用：子程序的建立時間不得早於父程序（父程序已經結束、PID 被別人拿去時，別人的子程序不會被算進來）。
//   瀏覽器——沒有 --type= 的 chrome 主程序，父程序是上面那些 node 之一（puppeteer 開的 chrome 指令列不含 MealMate 也不含 mm-）。
// 已知限制：不在執行器底下、又用相對路徑開的（例：npm test 那條路）認不到——監看是給突變長跑用的，那時一定有執行器。
function workersOf(all, runners) {
  const mine = (c) => c.includes('MealMate') || c.includes('\\Temp\\mm-') || c.includes('/Temp/mm-');
  const isMe = (x) => (x.CommandLine ?? '').includes('memwatch');
  const byPid = new Map(all.map((x) => [x.ProcessId, x]));
  const ours = new Set([...all.filter((x) => x.Name === 'node.exe' && mine(x.CommandLine ?? '')), ...runners].map((x) => x.ProcessId));
  for (let grew = true; grew;) {
    grew = false;
    for (const x of all) {
      const p = byPid.get(x.ParentProcessId);
      if (x.Name === 'node.exe' && !ours.has(x.ProcessId) && p && ours.has(p.ProcessId) && x.Born >= p.Born) { ours.add(x.ProcessId); grew = true; }
    }
  }
  const nodes = all.filter((x) => x.Name === 'node.exe' && ours.has(x.ProcessId) && !isMe(x));
  const browsers = all.filter((x) => /^chrome(-headless-shell)?\.exe$/.test(x.Name) && !(x.CommandLine ?? '').includes('--type=') && ours.has(x.ParentProcessId) && x.Born >= (byPid.get(x.ParentProcessId)?.Born ?? '~'));
  return { nodes, browsers };
}

log(`開始（第二版）：門檻 ${TH} MB、連續 ${COUNT} 次、每 ${IV} 秒；綁「node 相對路徑 ${RUNNER}」的執行器（每一輪重找），連續 ${GRACE} 輪找不到就結束`);
let below = 0; let checks = 0; let peakWorkers = 0; let missing = 0; const seen = new Map();
for (;;) {
  const all = procs();
  const runners = all.filter((x) => x.Name === 'node.exe' && runnerRe.test(x.CommandLine ?? ''));
  for (const r of runners) {
    const id = `${r.ProcessId}@${r.Created}`;
    if (!seen.has(id)) { seen.set(id, r); log(`接上執行器 node.exe(${r.ProcessId}，${r.Created} 建立)｜${clean(r.CommandLine)}`); }
  }
  if (!runners.length) {
    missing += 1;
    log(`這一輪找不到執行器（連續第 ${missing} 輪）`);
    if (missing >= GRACE) { log(`連續 ${GRACE} 輪找不到執行器，監看結束（看過的執行器 ${seen.size} 支）`); break; }
  } else missing = 0;
  const f = freeMB(); checks += 1;
  below = f < TH ? below + 1 : 0;
  if (below) log(`可用 ${f} MB，低於 ${TH}（連續第 ${below} 次）`);
  if (COUNT_WORKERS) {
    const { nodes, browsers } = workersOf(all, runners);
    const n = nodes.length + browsers.length;
    peakWorkers = Math.max(peakWorkers, n);
    if (n > 4 || checks % 12 === 1 || browsers.length) log(`本 repo 工作程序：node ${nodes.length}＋瀏覽器 ${browsers.length}＝${n}${n > 4 ? '　← 超過 4 個' : ''}；到目前峰值 ${peakWorkers}`);
  }
  if (below >= COUNT && runners.length) {
    const top = [...all].sort((a, b) => b.WorkingSetSize - a.WorkingSetSize).slice(0, 10).map((x) => `${x.Name}(${x.ProcessId}) ${Math.round(x.WorkingSetSize / 1048576)} MB`);
    log(`連續 ${COUNT} 次低於 ${TH} MB，停下。當下前 10 名：${top.join('｜')}`);
    // 停之前再查一次：同一個 PID、名稱、建立時間都對才停（這一輪到現在之間可能已經結束、PID 被別人拿去）
    const again = procs();
    const live = runners.filter((r) => again.some((x) => x.ProcessId === r.ProcessId && x.Name === r.Name && x.Created === r.Created));
    log(`要停的執行器（三項確認都過）：${live.map((t) => `node.exe(${t.ProcessId}，${t.Created})`).join('、') || '（沒有）'}；沒過確認的：${runners.filter((r) => !live.includes(r)).map((t) => `node.exe(${t.ProcessId})`).join('、') || '（沒有）'}`);
    for (const t of live) {
      try { execFileSync('taskkill', ['/PID', String(t.ProcessId), '/F'], { stdio: 'ignore' }); log(`已停 node.exe(${t.ProcessId})`); } catch { log(`停 node.exe(${t.ProcessId}) 失敗（可能已經結束）`); }
    }
    const after = procs();
    log(`停之後還在的執行器：${live.filter((t) => after.some((x) => x.ProcessId === t.ProcessId && x.Created === t.Created)).length} 支`);
    process.exitCode = 3; break;
  }
  if (checks >= MAX) { log(`查了 ${checks} 次、都沒有連續 ${COUNT} 次低於門檻，結束`); break; }
  await sleep(IV * 1000);
}

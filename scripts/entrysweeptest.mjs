// 入口的收拾：行為情境（2026-10-08，補 doctest WT5 的盲區——WT5 只守「呼叫那一行字還在」，已實測擋不住 `if (false)`）。
//
// 每個入口各一種情境：一支子程序照正式的命名法（ownername.wtPrefix：名字帶它自己的 PID＋建立時間）建一個 worktree，
// 被 taskkill /F 停掉（「上一層被殺」），留下 worktree；再從真實入口開跑，入口開頭的收拾要真的收掉它。
// （gatemutants 那個入口的同一種情境在 doctest WT5b。）
//
// 不必讓入口整支跑完：收拾在入口一開頭就跑。看到「收拾之後才會出現的那一行」（每個入口登記一個）就停掉它
// （入口經 jobrun 開，停掉時整棵樹一起收）。**判定分三種，不混在一起**：
//   · 看到那一行、worktree 被收掉了                → 通過
//   · 看到那一行（入口確實走過收拾點）、worktree 還在 → 紅：入口沒收拾
//   · 等到逾時都沒看到那一行                         → 「⊘ 情境未成立」（不知道入口走到哪裡——改了訊息、輸出被緩衝、
//     入口提早失敗都長這樣；不能報成「入口沒收拾」）。執行器的判定器看到 ⊘ 就把整支判成不算數
//
// **執行器與 buildguard-verify 在 repo 的暫存 clone 裡跑，不在主 repo**——兩個理由（下一個改這支測試的人會先讀這裡）：
//   一、執行器：突變進行中時主 repo 裡有還原紀錄（scripts/.mutation-pending.json）——在主 repo 再開一個執行器，
//       它會把那份紀錄當成「上一次被中斷」，把外層正在改壞的檔還原掉（真實破壞：外層那條突變就量錯了）。
//   二、buildguard-verify：一開跑就刪自己的登記（推送閘門第零關之二比對用的那份）——在主 repo 跑會把 HEAD 的 F8 登記刪掉。
// clone 拿到的是已 commit 的版本，所以把工作區的 scripts/ 覆蓋過去，並**斷言 clone 裡每一支的雜湊等於工作區的**——
// 覆蓋失敗時，測試會對著一個沒有這次改動的入口跑，然後報出一個看起來正常的結果（兩個來源要確認不同、而且都非空）。
// doctest 在主 repo 跑：它開頭的收拾在任何子程序開出來之前，看到第一個段落標題就停掉，不會留下東西。
//
// 只在 Windows 有意義（taskkill、Job）；不在 npm test 的鏈裡（開好幾支程序、約 1–2 分鐘），單獨跑：node scripts/entrysweeptest.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ok, section, done, note } from './tap.mjs';
import { ownerOf } from './ownername.mjs';
import { tempWorktrees } from './worktreesweep.mjs';
import { NO_SCENARIO_MARK } from './runkind.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const JOBRUN = path.join(ROOT, 'scripts', 'jobrun.mjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (p) => path.resolve(p).toLowerCase();
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const git = (dir, ...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000 });

if (process.platform !== 'win32') { note('不是 Windows：taskkill、Job 都沒有，沒驗'); done('entrysweeptest'); process.exit(0); }

/** 上一層：子程序在 repo 建一個名字帶自己的 worktree，然後被 taskkill /F 停掉。回 { wt, pid } */
async function killedLayer(repo, tag) {
  const flag = path.join(os.tmpdir(), `entrysweep-${process.pid}-${tag}-${Date.now()}.txt`);
  const ownerUrl = pathToFileURL(path.join(ROOT, 'scripts', 'ownername.mjs')).href;
  const code = `import fs from 'node:fs'; import { execFileSync } from 'node:child_process'; import { wtPrefix } from ${JSON.stringify(ownerUrl)};
const dir = fs.mkdtempSync(wtPrefix('wtprobe')); fs.rmSync(dir, { recursive: true });
execFileSync('git', ['-C', ${JSON.stringify(repo)}, 'worktree', 'add', '-q', '--detach', dir, 'HEAD']);
fs.writeFileSync(${JSON.stringify(flag)}, dir); setTimeout(() => {}, 120000);`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', code], { stdio: 'ignore' });
  for (let i = 0; i < 60 && !fs.existsSync(flag); i += 1) await sleep(500);
  const wt = fs.existsSync(flag) ? fs.readFileSync(flag, 'utf8').trim() : null;
  fs.rmSync(flag, { force: true });
  try { execFileSync('taskkill', ['/PID', String(child.pid), '/F'], { stdio: 'ignore', timeout: 60000 }); } catch { /* 下面驗 */ }
  await sleep(800);
  const alive = (() => { try { process.kill(child.pid, 0); return true; } catch { return false; } })();
  const listed = wt ? tempWorktrees(repo).map(norm).includes(norm(wt)) : false;
  ok(!!wt && listed && !alive && ownerOf(wt)?.pid === child.pid,
    `（前提）入口・${tag}：上一層建了 worktree（名字帶它的 PID ${ownerOf(wt ?? '')?.pid ?? '讀不出'}）、被 taskkill /F 停掉了（還活著：${alive}）、worktree 留下來了（${listed}）`);
  return { wt, pid: child.pid };
}

/** 從入口開跑，等到「收掉 <wt>」那一行或「收拾之後才會出現的那一行」或結束或逾時；之後停掉（經 jobrun，整棵樹一起收）。 */
async function runEntry(args, cwd, afterSweepRe, wtName, timeoutMs = 120000) {
  const p = spawn(process.execPath, [JOBRUN, process.execPath, ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; let how = null;
  const check = () => {
    const lines = out.split('\n');
    if (lines.some((l) => l.includes('worktree 收拾：收掉') && l.includes(wtName))) how = how ?? 'swept';
    else if (lines.some((l) => afterSweepRe.test(l.trim()))) how = how ?? 'passed';
  };
  p.stdout.on('data', (b) => { out += b.toString(); check(); });
  p.stderr.on('data', (b) => { out += b.toString(); });
  const exited = new Promise((r) => p.on('exit', () => r()));
  const t0 = Date.now();
  while (!how && p.exitCode === null && Date.now() - t0 < timeoutMs) await sleep(200);
  check();
  if (!how && p.exitCode !== null) how = 'exit-without-marker';
  if (!how) how = 'timeout';
  if (p.exitCode === null) { try { execFileSync('taskkill', ['/PID', String(p.pid), '/F'], { stdio: 'ignore', timeout: 60000 }); } catch { /* 已經結束 */ } }
  await Promise.race([exited, sleep(5000)]);
  return { how, out };
}

/** 一個入口的判定（三種分開）：看到收掉 → 驗清單與目錄；看到收拾點之後的那一行、worktree 還在 → 紅；沒看到那一行 → 情境未成立 */
/** 判定的分類（純函式，對照組直接餵）：沒看到收拾點之後的那一行 → 情境未成立；看到了 → 收了或沒收 */
function classify(how) {
  if (how === 'timeout' || how === 'exit-without-marker') return 'noscenario';
  return how === 'swept' ? 'swept' : 'not-swept';
}

// label 在呼叫的地方寫成完整字面（突變的 expect 要在原始碼裡找得到那一段字）
function judgeEntry(label, repo, wt, r) {
  const listed = tempWorktrees(repo).map(norm).includes(norm(wt));
  if (classify(r.how) === 'noscenario') {
    console.log(`${NO_SCENARIO_MARK}：${label}——沒看到「收拾之後才會出現的那一行」（${r.how === 'timeout' ? '等到逾時' : '入口提早結束'}）——不知道入口走到哪裡，不能報成「入口沒收拾」。輸出開頭：${r.out.split('\n').slice(0, 3).join('｜').slice(0, 200)}`);
    return;
  }
  ok(r.how === 'swept' && !listed && !fs.existsSync(wt),
    `${label}留下的 worktree，從入口開跑時被收掉了（${r.how === 'swept' ? '入口印了收掉那一行' : '入口走過了收拾點卻沒收'}；清單裡還在：${listed}）`);
}

/** repo 的暫存 clone，工作區的 scripts/ 覆蓋過去，斷言每一支的雜湊等於工作區的 */
function cloneWithWorkingScripts(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `entrysweep-clone-${tag}-`));
  execFileSync('git', ['clone', '-q', ROOT, dir], { stdio: 'ignore', timeout: 120000 });
  const files = fs.readdirSync(path.join(ROOT, 'scripts')).filter((f) => /\.(m?js|ps1|sh)$/.test(f));
  for (const f of files) fs.copyFileSync(path.join(ROOT, 'scripts', f), path.join(dir, 'scripts', f));
  const diff = files.filter((f) => sha(path.join(ROOT, 'scripts', f)) !== sha(path.join(dir, 'scripts', f)));
  ok(files.length >= 50 && diff.length === 0 && norm(dir) !== norm(ROOT),
    `（前提）入口・${tag}：暫存 clone 的 scripts/ 跟工作區逐支相同（比了 ${files.length} 支、不同 ${diff.length} 支${diff.length ? `：${diff.slice(0, 3).join('、')}` : ''}）——不然測的是沒有這次改動的入口`);
  return dir;
}

const cleanups = [];
try {
  section('對照：逾時、提早結束都判「情境未成立」，不判「入口沒收拾」');
  {
    // 真的開兩支：一支永遠不印那一行（等到逾時）、一支什麼都沒印就結束；再給一個「印了收拾點之後的那一行、沒收」的
    const t = await runEntry(['-e', 'setTimeout(() => {}, 60000)'], ROOT, /這一行永遠不會出現/, '（沒有）', 3000);
    const x = await runEntry(['-e', ''], ROOT, /這一行永遠不會出現/, '（沒有）', 30000);
    const p = await runEntry(['-e', "console.log('收拾點之後的那一行')"], ROOT, /^收拾點之後的那一行$/, '（沒有）', 30000);
    ok(t.how === 'timeout' && x.how === 'exit-without-marker' && p.how === 'passed'
      && classify(t.how) === 'noscenario' && classify(x.how) === 'noscenario' && classify(p.how) === 'not-swept',
    `入口・對照：等到逾時 → ${classify(t.how)}、提早結束 → ${classify(x.how)}（兩種都要是情境未成立）；看到收拾點之後的那一行卻沒收 → ${classify(p.how)}（要是沒收拾）`);
  }

  section('執行器（暫存 clone 裡；--only 一個不存在的關鍵字：收拾之後就停）');
  {
    const repo = cloneWithWorkingScripts('runner');
    cleanups.push(() => fs.rmSync(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));
    const { wt } = await killedLayer(repo, '執行器');
    if (wt) cleanups.push(() => fs.rmSync(wt, { recursive: true, force: true }));
    const r = await runEntry(['scripts/mutationtest.mjs', '--only', '沒有這一條突變的關鍵字'], repo, /選了 0 條突變/, path.basename(wt ?? '（沒有）'));
    if (wt) judgeEntry('入口・執行器：上一層被殺時', repo, wt, r);
  }

  section('doctest（主 repo；看到第一個段落標題就停掉）');
  {
    const { wt } = await killedLayer(ROOT, 'doctest');
    if (wt) cleanups.push(() => { try { git(ROOT, 'worktree', 'remove', '--force', wt); } catch { /* 已經被收 */ } fs.rmSync(wt, { recursive: true, force: true }); });
    const r = await runEntry(['scripts/doctest.mjs'], ROOT, /^— PLAN §1\.2/, path.basename(wt ?? '（沒有）'));
    if (wt) judgeEntry('入口・doctest：上一層被殺時', ROOT, wt, r);
  }

  section('buildguard-verify（暫存 clone 裡；--only foods）');
  {
    const repo = cloneWithWorkingScripts('bg');
    cleanups.push(() => fs.rmSync(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));
    const { wt } = await killedLayer(repo, 'buildguard-verify');
    if (wt) cleanups.push(() => fs.rmSync(wt, { recursive: true, force: true }));
    const r = await runEntry(['--max-old-space-size=4096', 'scripts/buildguard-verify.mjs', '--rev', 'HEAD', '--only', 'foods'], repo, /^版本 /, path.basename(wt ?? '（沒有）'));
    if (wt) judgeEntry('入口・buildguard-verify：上一層被殺時', repo, wt, r);
  }
} catch (e) {
  ok(false, `入口・測試本身出錯：${e.message}`);
} finally {
  for (const c of cleanups.reverse()) { try { c(); } catch { /* 下面驗 */ } }
  try { git(ROOT, 'worktree', 'prune'); } catch { /* 照樣往下 */ }
  const left = tempWorktrees(ROOT).filter((w) => /mm-wtprobe-/.test(w));
  ok(left.length === 0, `入口・收尾：主 repo 的 worktree 清單裡沒有留下這支測試造的（${left.length} 個）`);
}
done('entrysweeptest');

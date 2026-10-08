// 測試鏈逐支計時（2026-10-08，第 7 項：執行器給每支測試的時限要有 3 倍餘裕，帳本裡有 20 支沒有秒數）。
//
//   node scripts/chaintime.mjs        依 package.json 的 test 鏈，一支一支依序跑（跟 npm test 同樣的開法：node scripts/<名>.mjs），逐支計時
//
// 結果寫進 scripts/test-timings.json（耗時數字進版控，共用慣例 §5.7）：每支 { seconds, code, date, commit }，另記這一次量到幾支／應該有幾支。
// 不寫進突變帳本：那份以突變名稱為鍵、有自己的格式與孤兒檢查，混進測試名會被當成不認得的條目。
// **母體數字印在輸出裡**：量到幾支／應該有幾支，缺的與沒過的逐支點名——只看「跑完了、有 21 筆耗時」，缺席的那幾支不會有任何徵兆。
// 有缺、有沒過、讀不到測試鏈 → 回非 0。一支沒過照樣記它的秒數（標 code），不記成 0、也不跳過。
// 屬於重負載（約等於一次 npm test，含瀏覽器測試）：開跑前要許可。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { testsInChain } from './sincefull.mjs';
import { runProgram, KIND_LABELS } from './runkind.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const OUT = path.join(ROOT, 'scripts', 'test-timings.json');
// 單支上限 20 分鐘：沒量過，用 npm test 整支的 499 秒當上界還有 2.4 倍；只是不讓一支卡死整場，逾時那一支記成逾時、不算有耗時
const PER_TEST_TIMEOUT_MS = 20 * 60 * 1000;

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const fullChain = testsInChain(pkg);
if (!fullChain.length) { console.log('✗ 讀不到測試鏈（package.json 的 test）——一支都沒量'); process.exit(1); }
// --only a,b：只重量指定的幾支（例：某幾支的計時被別的程序干擾過），只更新它們的紀錄；指定了鏈裡沒有的名字就停
const oi = process.argv.indexOf('--only');
const only = oi >= 0 ? String(process.argv[oi + 1] ?? '').split(',').map((s) => s.trim()).filter(Boolean) : null;
if (only && (!only.length || only.some((n) => !fullChain.includes(n)))) { console.log(`✗ --only 指定的不在測試鏈裡：${only.filter((n) => !fullChain.includes(n)).join('、') || '（空的）'}`); process.exit(1); }
const chain = only ? fullChain.filter((n) => only.includes(n)) : fullChain;
let commit = '';
try { commit = execFileSync('git', ['-C', ROOT, 'rev-parse', '--short=12', 'HEAD'], { encoding: 'utf8', timeout: 60000 }).trim(); } catch { commit = '（取不到）'; }
const date = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
// 量測時機器上有沒有別的專案在跑（2026-10-09，Dispatch）：別的專案在跑時，連不開瀏覽器的測試都變慢——這件事要記在資料裡，不只寫在 STATUS。
// 只有明講 --machine-quiet（Dispatch 確認其他 Session 都待機）才記成「沒有其他專案在跑」；沒講就記「未確認」，不預設成乾淨
const MACHINE = process.argv.includes('--machine-quiet')
  ? `量測時機器上沒有其他專案在跑（${date}，Dispatch 確認其他 Session 都待機）`
  : '未確認量測時機器上有沒有其他專案在跑';

// 經 Job 跑（2026-10-08，Dispatch 准）：跟執行器同一套 runProgram（inJob＋要求結算行）——逾時被殺時，開瀏覽器的測試留下的瀏覽器
// 跟著 Job 一起收掉（原本只殺直接那一支，瀏覽器會留下來）。耗時照樣自己量（精確到 0.1 秒；runProgram 的秒數是整數）。
// 經 Job 每支多約 1–2 秒（建 Job＋結束前要結算），所以這裡量到的跟「未經 Job」那一輪不是同一把尺——每一筆記 via
const VIA = '經 Job';
const results = [];
for (const name of chain) {
  const t0 = Date.now();
  const r = runProgram([path.join(ROOT, 'scripts', `${name}.mjs`)], { cwd: ROOT, timeoutMs: PER_TEST_TIMEOUT_MS, inJob: true, finalOf: name });
  const seconds = Math.round((Date.now() - t0) / 100) / 10;
  const code = r.passed ? 0 : r.kind;
  results.push({ name, seconds, code });
  console.log(`${code === 0 ? '  ✓' : '  ✗'} ${name}｜${seconds} 秒｜${code === 0 ? '通過' : `${KIND_LABELS[code] ?? code}（不算有耗時）`}`);
}

const measured = results.filter((r) => r.code === 0);
const notOk = results.filter((r) => r.code !== 0);
const missing = chain.filter((n) => !results.some((r) => r.name === n));
let doc = { note: '', tests: {} };
try { doc = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch { /* 第一次：沒有檔 */ }
doc.note = '測試鏈逐支耗時（scripts/chaintime.mjs 寫，不手改）：每支最近一次量到的秒數、結束碼、日期、commit、via（怎麼量的）。執行器的時限照這裡的最長值算 3 倍餘裕。via 不同的不是同一把尺（經 Job 每支多約 1–2 秒）。';
// 改經 Job 之前量的（沒有 via）標成「未經 Job」——不跟新量的混在同一張表裡不說明
for (const t of Object.values(doc.tests ?? {})) if (!t.via) t.via = '未經 Job（2026-10-08 第一輪，chaintime 改經 Job 之前）';
// 加 machine 欄之前量的：照實標成可能受污染（2026-10-08 那一輪量的時候 CertQuiz 等別的專案在跑）
for (const t of Object.values(doc.tests ?? {})) if (!t.machine) t.machine = '可能受污染：加這一欄之前量的（2026-10-08 那一輪，量的時候有別的專案在跑）';
for (const r of results) if (r.code === 0) doc.tests[r.name] = { seconds: r.seconds, code: r.code, date, commit, via: VIA, machine: MACHINE };
doc.lastRun = { date, commit, machine: MACHINE, scope: only ? `只量 ${chain.join('、')}` : '整條測試鏈', expected: chain.length, measured: measured.length, notOk: notOk.map((r) => `${r.name}（${r.code}）`), missing };
fs.writeFileSync(OUT, `${JSON.stringify(doc, null, 1)}\n`);

const total = Math.round(results.reduce((a, r) => a + r.seconds, 0));
console.log(`\n量到 ${measured.length} 支／應該有 ${chain.length} 支（${only ? `這次指定的；整條鏈 ${fullChain.length} 支` : '測試鏈'}）；合計 ${total} 秒${notOk.length ? `；沒過 ${notOk.length} 支：${notOk.map((r) => `${r.name}（${r.code}）`).join('、')}` : ''}${missing.length ? `；缺 ${missing.length} 支：${missing.join('、')}` : ''}`);
console.log(`量測時的機器：${MACHINE}`);
const vias = {}; for (const t of Object.values(doc.tests)) vias[t.via] = (vias[t.via] ?? 0) + 1;
console.log(`寫進 ${path.relative(ROOT, OUT)}；表裡 ${Object.keys(doc.tests).length} 支，怎麼量的：${Object.entries(vias).map(([v, n]) => `${v} ${n} 支`).join('、')}${Object.keys(vias).length > 1 ? '——兩種尺混在一起，比較時限餘裕時要分開看' : ''}`);
process.exit(measured.length === chain.length && !missing.length ? 0 : 1);

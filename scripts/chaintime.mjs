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

const results = [];
for (const name of chain) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [path.join('scripts', `${name}.mjs`)], { cwd: ROOT, encoding: 'utf8', timeout: PER_TEST_TIMEOUT_MS, maxBuffer: 1 << 26 });
  const seconds = Math.round((Date.now() - t0) / 100) / 10;
  const timedOut = r.error?.code === 'ETIMEDOUT';
  const code = timedOut ? 'timeout' : r.status;
  results.push({ name, seconds, code });
  console.log(`${code === 0 ? '  ✓' : '  ✗'} ${name}｜${seconds} 秒｜${timedOut ? '逾時（不算有耗時）' : `回 ${code}`}`);
}

const measured = results.filter((r) => r.code === 0);
const notOk = results.filter((r) => r.code !== 0);
const missing = chain.filter((n) => !results.some((r) => r.name === n));
let doc = { note: '', tests: {} };
try { doc = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch { /* 第一次：沒有檔 */ }
doc.note = '測試鏈逐支耗時（scripts/chaintime.mjs 寫，不手改）：每支最近一次量到的秒數、結束碼、日期、commit。執行器的時限照這裡的最長值算 3 倍餘裕。';
for (const r of results) if (r.code !== 'timeout') doc.tests[r.name] = { seconds: r.seconds, code: r.code, date, commit };
doc.lastRun = { date, commit, scope: only ? `只量 ${chain.join('、')}` : '整條測試鏈', expected: chain.length, measured: measured.length, notOk: notOk.map((r) => `${r.name}（${r.code}）`), missing };
fs.writeFileSync(OUT, `${JSON.stringify(doc, null, 1)}\n`);

const total = Math.round(results.reduce((a, r) => a + r.seconds, 0));
console.log(`\n量到 ${measured.length} 支／應該有 ${chain.length} 支（${only ? `這次指定的；整條鏈 ${fullChain.length} 支` : '測試鏈'}）；合計 ${total} 秒${notOk.length ? `；沒過 ${notOk.length} 支：${notOk.map((r) => `${r.name}（${r.code}）`).join('、')}` : ''}${missing.length ? `；缺 ${missing.length} 支：${missing.join('、')}` : ''}`);
console.log(`寫進 ${path.relative(ROOT, OUT)}`);
process.exit(measured.length === chain.length && !missing.length ? 0 : 1);

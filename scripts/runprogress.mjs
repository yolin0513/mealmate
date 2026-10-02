// 一場突變的逐條進度與結果統計（2026-10-02 Dispatch：中途可能被叫停，要分得出「收到結果的／被停掉的／沒輪到的」，不能只記總數——
// JLPT 那 29 條就是只剩總數，降級成無法複核）。
//
// 第一版是「逐條走計畫清單、到帳本查狀態、查不到就歸成還沒跑」——四類相加**永遠**等於清單長度，不管實際跑了幾條（遊戲專案
// 2026-10-02 查出自己的統計是同一個形狀；我當時只在註解裡寫「結構上必然」，沒有改成會擋的檢查——註解救不了一個不會擋的檢查）。
// 這一版三類分開、從不同的來源數：
//   收到的結果  從這一場每一份執行器 log 的「逐條突變」那一節逐行數（原始行數，含重複、含計畫外的——不先去重）
//   被停掉的    帳本的 inflight 正指著、而且 log 裡沒有結果的（改壞了、還沒收尾）
//   沒輪到的    計畫裡、log 裡一行都沒有、也不是被停掉的
// 三類相加與計畫的條數兩個數字都印；不相等就擋。會讓它不相等的正是要抓的：同一條收到兩次（重複）、收到計畫外的。另外：
//   · 重複、計畫外：點名、擋
//   · 獨立核對：帳本那一側記著「這一場（同一個 commit、不早於計畫日期）」而且在計畫裡的條數，要等於 log 那一側收到的不重複條數（兩個來源）
//   · 宣稱跑完（--complete）卻還有沒輪到或被停掉的：擋
//   · 每一份 log 自己：抽到的列數要等於它印的「選了 N 條」（少了＝那一份沒跑完）；不相等就把那一份標成沒跑完（只報，被停掉的會在上面算到）
//
// 用法：
//   node scripts/runprogress.mjs --save-plan <計畫檔>
//   node scripts/runprogress.mjs <計畫檔> [log ...] [--complete] [--ledger 帳本]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadMutations } from './checkmutations.mjs';
import { neverFullNames } from './depgraph.mjs';
import { parseRunnerLog } from './evidence.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const UNCOUNTED_VERDICTS = new Set(['情境未成立', '預期清單過期']);
// commit 比前綴：帳本記的是執行器印的 12 碼、計畫記 7 碼（2026-10-02 第一次對真資料就因為比「完全相等」而帳本那一側永遠是 0——獨立核對當場擋下）
const sameCommit = (a, b) => { const x = String(a ?? '').replace(/[-+]dirty$/, ''); const y = String(b ?? ''); return x.length >= 7 && y.length >= 7 && (x.startsWith(y) || y.startsWith(x)); };
const sameRun = (plan, l) => !!l && sameCommit(l.commit, plan?.commit) && String(l.date ?? '') >= String(plan?.date ?? '');

/** plan { commit, date, names[] }；logs [{ file, text }]；ledger。回 { counts, rows, problems, perLog } */
export function tallyRun(plan, logs, ledger, { complete = false } = {}) {
  const problems = [];
  const names = plan?.names ?? [];
  if (!names.length) problems.push('計畫的母體是 0 條（什麼都沒排）');
  if (!plan?.commit) problems.push('計畫沒有記 commit，判斷不了哪些結果是這一場的');
  const planSet = new Set(names);
  // 收到的結果：每一份 log 逐行，不去重
  const received = []; const perLog = [];
  for (const lg of logs) {
    const p = parseRunnerLog(lg.text);
    perLog.push({ file: lg.file, selected: p.selected, rows: p.rows.length, complete: p.selected !== null && p.selected === p.rows.length });
    for (const r of p.rows) received.push({ ...r, file: lg.file });
  }
  const seen = new Map();
  for (const r of received) seen.set(r.name, (seen.get(r.name) ?? 0) + 1);
  const dup = [...seen].filter(([, n]) => n > 1).map(([n, k]) => `${n}（${k} 次）`);
  const outside = [...seen.keys()].filter((n) => !planSet.has(n));
  if (dup.length) problems.push(`同一條收到不只一次：${dup.slice(0, 5).join('、')}${dup.length > 5 ? `…共 ${dup.length} 條` : ''}`);
  if (outside.length) problems.push(`收到計畫外的：${outside.slice(0, 5).join('、')}${outside.length > 5 ? `…共 ${outside.length} 條` : ''}`);
  // 被停掉的：帳本 inflight 指著、log 裡沒有結果
  const infl = ledger?.inflight?.mutation ?? null;
  const stopped = infl && planSet.has(infl) && !seen.has(infl) ? [infl] : [];
  // 沒輪到的
  const notRun = names.filter((n) => !seen.has(n) && !stopped.includes(n));
  const counts = {
    收到的結果: received.length,
    其中不算數: received.filter((r) => UNCOUNTED_VERDICTS.has(r.verdict)).length,
    其中紅在預期: received.filter((r) => r.verdict === '抓到').length,
    被停掉的: stopped.length,
    沒輪到的: notRun.length,
  };
  const sum = counts.收到的結果 + counts.被停掉的 + counts.沒輪到的;
  if (sum !== names.length) problems.push(`三類相加 ${sum} 條 ≠ 計畫 ${names.length} 條`);
  // 獨立核對：帳本那一側
  const ledgerSide = names.filter((n) => sameRun(plan, ledger?.entries?.[n]?.last)).length;
  const logSide = [...seen.keys()].filter((n) => planSet.has(n)).length;
  if (ledgerSide !== logSide) problems.push(`帳本那一側記著這一場跑了計畫裡的 ${ledgerSide} 條，log 那一側收到 ${logSide} 條（不重複）——對不上`);
  if (complete && (notRun.length || stopped.length)) problems.push(`宣稱跑完，卻還有沒輪到的 ${notRun.length} 條、被停掉的 ${stopped.length} 條`);
  const rows = names.map((n) => ({ name: n, state: seen.has(n) ? `收到（${received.find((r) => r.name === n).verdict}）` : stopped.includes(n) ? '被停掉' : '沒輪到' }));
  return { counts, sum, ledgerSide, logSide, rows, problems, perLog, notRun, stopped };
}

/** 對照組（§5.3）：合成的計畫、log、帳本，每一種情況各一個 */
export function controls() {
  const bad = [];
  const mk = (rows) => `— 前置 —\n  · 選了 ${rows.length} 條突變（共 9）；跑法 never-full\n\n— 逐條突變 —\n${rows.map((n) => `  ✓ 【t】${n}`).join('\n')}\n`;
  const plan = { commit: 'abc1234', date: '2026-10-02', names: ['A', 'B', 'C', 'D'] };
  const ledger = { inflight: { mutation: 'C' }, entries: { A: { last: { commit: 'abc1234', date: '2026-10-02' } }, B: { last: { commit: 'abc1234def56+dirty', date: '2026-10-02' } } } };   // B：帳本記 12 碼（真資料就是這樣）
  const ok0 = tallyRun(plan, [{ file: 'x', text: mk(['A', 'B']) }], ledger);
  if (ok0.problems.length || ok0.counts.收到的結果 !== 2 || ok0.counts.被停掉的 !== 1 || ok0.counts.沒輪到的 !== 1) bad.push(`正常樣本：應收到 2、停掉 1、沒輪到 1、沒問題，實際 ${JSON.stringify(ok0.counts)}｜${ok0.problems.join('；')}`);
  const dup = tallyRun(plan, [{ file: 'x', text: mk(['A', 'B']) }, { file: 'x2', text: mk(['A', 'B']) }], ledger);
  if (!dup.problems.some((s) => s.includes('不只一次')) || !dup.problems.some((s) => s.includes('三類相加'))) bad.push('同一份 log 給兩次：要報重複、相加對不上');
  const out = tallyRun(plan, [{ file: 'x', text: mk(['A', 'B', 'Z']) }], ledger);
  if (!out.problems.some((s) => s.includes('計畫外的：Z'))) bad.push('收到計畫外的 Z：要點名');
  const miss = tallyRun(plan, [{ file: 'x', text: mk(['A']) }], ledger, { complete: true });
  if (!miss.problems.some((s) => s.includes('對不上')) || !miss.problems.some((s) => s.includes('宣稱跑完'))) bad.push('少給一份 log（B 帳本有、log 沒有）：要報兩邊對不上、宣稱跑完卻有沒輪到的');
  if (!tallyRun({ commit: 'x', date: 'd', names: [] }, [], {}).problems.some((s) => s.includes('0 條'))) bad.push('母體 0 條要報');
  return bad;
}

function main() {
  const args = process.argv.slice(2);
  const bad = controls();
  if (bad.length) { console.log(`✗ 進度統計的對照組不過（判斷壞了）：${bad.join('｜')}`); return 1; }
  const li = args.indexOf('--ledger');
  const ledgerPath = li >= 0 ? args[li + 1] : path.join(ROOT, 'scripts/mutation-ledger.json');
  if (!ledgerPath || !fs.existsSync(ledgerPath)) { console.log('✗ 讀不到帳本'); return 1; }
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  if (args[0] === '--save-plan') {
    const out = args[1];
    if (!out) { console.log('✗ --save-plan 要給計畫檔路徑'); return 1; }
    const muts = loadMutations(fs.readFileSync(path.join(ROOT, 'scripts/mutationtest.mjs'), 'utf8')) ?? [];
    const names = neverFullNames(muts.map((m) => m.name), ledger);
    const commit = execFileSync('git', ['-C', ROOT, 'rev-parse', '--short=7', 'HEAD'], { encoding: 'utf8' }).trim();
    const date = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
    const byTest = {};
    for (const n of names) { const t = muts.find((m) => m.name === n)?.test ?? '？'; byTest[t] = (byTest[t] ?? 0) + 1; }
    fs.writeFileSync(out, `${JSON.stringify({ commit, date, names }, null, 1)}\n`);
    console.log(`計畫：${names.length} 條（從帳本算的「從沒整套跑過」，不是寫死的數字），commit ${commit}、${date}；各測試 ${Object.entries(byTest).map(([t, n]) => `${t} ${n}`).join('、')}`);
    return names.length ? 0 : 1;
  }
  const skip = new Set(li >= 0 ? [li, li + 1] : []);
  const pos = args.filter((a, i) => !skip.has(i) && !a.startsWith('--'));
  const planFile = pos[0];
  if (!planFile || !fs.existsSync(planFile)) { console.log(`✗ 讀不到計畫檔（${planFile ?? '沒給'}）`); return 1; }
  const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'));
  const logs = [];
  for (const f of pos.slice(1)) { if (!fs.existsSync(f)) { console.log(`✗ 讀不到 log：${f}`); return 1; } logs.push({ file: f, text: fs.readFileSync(f, 'utf8') }); }
  const t = tallyRun(plan, logs, ledger, { complete: args.includes('--complete') });
  for (const r of t.rows) console.log(`  ${r.state}｜${r.name}`);
  for (const p of t.perLog) console.log(`  log｜${path.basename(p.file)}｜選了 ${p.selected} 條、抽到 ${p.rows} 列${p.complete ? '' : '（沒跑完或解析漏了）'}`);
  console.log(`計畫 ${plan.names.length} 條；收到的結果 ${t.counts.收到的結果} 列（從 ${logs.length} 份 log 逐行數，含重複；其中紅在預期 ${t.counts.其中紅在預期}、不算數 ${t.counts.其中不算數}）＋被停掉 ${t.counts.被停掉的}（帳本 inflight）＋沒輪到 ${t.counts.沒輪到的} ＝ ${t.sum}`);
  console.log(`獨立核對：帳本那一側記著這一場跑了計畫裡的 ${t.ledgerSide} 條、log 那一側收到 ${t.logSide} 條（不重複）`);
  if (t.problems.length) { console.log(`✗ ${t.problems.join('；')}`); return 1; }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main();

// 一場突變的逐條進度（2026-10-02 Dispatch：中途可能被叫停，要分得出「跑完的／開了頭沒跑完的／還沒跑的」，不能只記總數——
// JLPT 那 29 條就是只剩總數，降級成無法複核；做法抄 TripQuest：逐條標狀態，各類相加必須等於母體）。
//
// 用法：
//   node scripts/runprogress.mjs --save-plan <計畫檔>   開跑前：把這一場要跑的母體（現在從沒整套跑過的那幾條，照帳本算）寫成計畫檔，記下 commit
//   node scripts/runprogress.mjs <計畫檔>               任何時候：逐條列狀態、各類條數、相加是否等於母體
// 狀態（只看帳本，不看 log）：
//   跑完、算數        帳本 last 的 commit＝計畫的 commit、日期不早於計畫日期、counted＝true（紅了沒另外標）
//   跑完、不算數      同上但 counted＝false（逾時、被殺、情境未成立、預期清單過期……下次要再跑）
//   開了頭沒跑完      帳本的 inflight 正指著它（改壞了、還沒收尾）
//   還沒跑            以上皆非
// 計畫檔與帳本讀不到、母體是 0 條、各類相加不等於母體，都回非 0（§5.13：判斷不了不是沒事）。
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadMutations } from './checkmutations.mjs';
import { neverFullNames } from './depgraph.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
export const STATES = ['跑完、算數', '跑完、不算數', '開了頭沒跑完', '還沒跑'];

/** plan: { commit, date, names[] }；ledger: 帳本物件。回 { rows: [{ name, state, red }], counts, problems } */
export function progressOf(plan, ledger) {
  const problems = [];
  if (!plan?.names?.length) problems.push('計畫的母體是 0 條（什麼都沒排）');
  if (!plan?.commit) problems.push('計畫沒有記 commit，判斷不了哪些結果是這一場的');
  const inflight = ledger?.inflight?.mutation ?? null;
  const rows = (plan?.names ?? []).map((name) => {
    const l = ledger?.entries?.[name]?.last;
    const thisRun = !!l && String(l.commit ?? '').replace(/[-+]dirty$/, '') === plan.commit && String(l.date ?? '') >= String(plan.date ?? '');
    let state = '還沒跑';
    if (inflight === name) state = '開了頭沒跑完';
    else if (thisRun && l.counted === true) state = '跑完、算數';
    else if (thisRun && l.counted === false) state = '跑完、不算數';
    return { name, state, red: thisRun ? l.red === true : null, kind: thisRun ? l.kind ?? null : null };
  });
  const counts = Object.fromEntries(STATES.map((s) => [s, rows.filter((r) => r.state === s).length]));
  // 各類相加＝母體在這裡是**結構上必然**的（每一條只會落在一類），印出來給人核，不是獨立的檢查；
  // 防「只剩總數」靠的是逐條都列出來。另外列帳本裡「這一場跑了、但不在計畫裡」的（例：同一個 commit 上的 --only 補跑），只報不擋
  const planSet = new Set(plan?.names ?? []);
  const outside = Object.entries(ledger?.entries ?? {}).filter(([n, e]) => !planSet.has(n) && e?.last && String(e.last.commit ?? '').replace(/[-+]dirty$/, '') === plan?.commit && String(e.last.date ?? '') >= String(plan?.date ?? '')).map(([n]) => n);
  return { rows, counts, problems, outside };
}

export function controls() {
  const bad = [];
  const plan = { commit: 'abc1234', date: '2026-10-02', names: ['A', 'B', 'C', 'D', 'E'] };
  const ledger = { inflight: { mutation: 'C' }, entries: {
    A: { last: { commit: 'abc1234', date: '2026-10-02', counted: true, red: true } },
    B: { last: { commit: 'abc1234+dirty', date: '2026-10-03', counted: false, red: false, kind: 'timeout' } },
    D: { last: { commit: 'old0000', date: '2026-10-02', counted: true, red: true } },        // 別的 commit 跑的，不算這一場
    E: { last: { commit: 'abc1234', date: '2026-10-01', counted: true, red: true } },        // 計畫之前跑的，不算這一場
  } };
  const p = progressOf(plan, ledger);
  const got = p.rows.map((r) => r.state).join(',');
  if (got !== '跑完、算數,跑完、不算數,開了頭沒跑完,還沒跑,還沒跑') bad.push(`五條的狀態分錯：${got}`);
  if (p.problems.length) bad.push(`正常樣本不該有問題：${p.problems.join('；')}`);
  if (!progressOf({ commit: 'x', date: 'd', names: [] }, ledger).problems.some((s) => s.includes('0 條'))) bad.push('母體 0 條要報');
  return bad;
}

function main() {
  const args = process.argv.slice(2);
  const bad = controls();
  if (bad.length) { console.log(`✗ 進度表的對照組不過（判斷壞了）：${bad.join('｜')}`); return 1; }
  const ledgerPath = path.join(ROOT, 'scripts/mutation-ledger.json');
  if (!fs.existsSync(ledgerPath)) { console.log('✗ 讀不到帳本'); return 1; }
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
  const planFile = args[0];
  if (!planFile || !fs.existsSync(planFile)) { console.log(`✗ 讀不到計畫檔（${planFile ?? '沒給'}）`); return 1; }
  const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'));
  const p = progressOf(plan, ledger);
  for (const r of p.rows) console.log(`  ${r.state}｜${r.name}${r.state.startsWith('跑完') ? `｜${r.kind ?? '—'}｜紅 ${r.red}` : ''}`);
  console.log(`母體 ${p.rows.length} 條（計畫檔逐條數的）：${STATES.map((s) => `${s} ${p.counts[s]}`).join('、')}；相加 ${Object.values(p.counts).reduce((a, b) => a + b, 0)}（結構上必然相等）`);
  console.log(`帳本裡這一場跑了、但不在計畫裡的 ${p.outside.length} 條${p.outside.length ? `：${p.outside.slice(0, 8).join('、')}` : ''}`);
  if (p.problems.length) { console.log(`✗ ${p.problems.join('；')}`); return 1; }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main();

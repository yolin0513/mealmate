// 中斷與續跑的驗法（2026-10-02，Dispatch：「先用 2～3 條突變實際製造一次中斷，確認還原與續跑，各配一個對照組」；共用慣例 v11 §5.20）
//
// 兩條路平常走不到、壞了最惡劣：
//   還原（recoverPending）：失敗會把改壞的原始碼留在工作區
//   續跑（--full 再下一次）：失敗會讓後半段靜默跳過，卻印出看起來正常的總數
// 做法：在暫存目錄 git init 一個小 repo（scripts/ 的複本＋三支各睡 2 秒的探針測試＋三條突變），
//   1. 用 --full 開跑，等第一條記進帳本、第二條正在跑（改壞的檔在磁碟上、pending 檔在）時，把執行器整個殺掉
//   2. （前提）第二條的目標檔確實是改壞的、pending 檔在
//   3. --full --limit 1：開頭要說「已還原」；跑完後目標檔的**內容雜湊**等於原樣；結尾要說「整套還沒收齊」並**點名**第三條
//   4. --full：只跑第三條；帳本三條都在同一個 commit 上算數、紅；寫了「整套跑完」的基準清單
//   判定不靠執行器自己的話：探針測試每跑一次就在帳本外的標記檔寫一行（是不是改壞的版本），用它數每一條實際跑了幾次。
// 對照組（同一套流程，複本裡的程式故意弄壞）：
//   壞的還原（recoverPending 什麼都不做）→ 必須在「還原」那一關報不符
//   壞的接續點（doneAt 一律當成跑過）    → 必須在「續跑」那一關報不符（執行器自己可能照樣印「整套收齊」——那正是要抓的）
// 回傳：0 正常流程全過、兩個對照組都在預期那一關報不符；1 正常流程有一關不符；2 對照組沒抓到（或抓在別關）；3 造情境失敗
// 重負載（開 2 個工作程序、約 1–2 分鐘）：經 Dispatch 排時段才跑（v11 §5.19）。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ORIGINAL = 'export const BROKEN = false;\n';

class SetupError extends Error {}

function makeRepo(variant) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `mm-rv-${variant}-`));
  const mark = `${root}.ran.log`;                                       // 帳本外、repo 外：不會進任何依賴範圍
  fs.mkdirSync(path.join(root, 'scripts')); fs.mkdirSync(path.join(root, 'js'));
  for (const f of fs.readdirSync(path.join(ROOT, 'scripts'))) {
    if (/\.m?js$/.test(f)) fs.copyFileSync(path.join(ROOT, 'scripts', f), path.join(root, 'scripts', f));
  }
  fs.copyFileSync(path.join(ROOT, 'js/version.js'), path.join(root, 'js/version.js'));
  // 跟真的 repo 一樣的行尾設定（eol=lf）：沒有它，這台機器的全域 autocrlf 會讓 git checkout 寫出 CRLF
  fs.copyFileSync(path.join(ROOT, '.gitattributes'), path.join(root, '.gitattributes'));
  for (const n of [1, 2, 3]) {
    fs.writeFileSync(path.join(root, `scripts/rvtarget${n}.mjs`), ORIGINAL);
    fs.writeFileSync(path.join(root, `scripts/rvtest${n}.mjs`),
      `import fs from 'node:fs';\nimport { ok, done } from './tap.mjs';\nimport { BROKEN } from './rvtarget${n}.mjs';\n`
      + `fs.appendFileSync(${JSON.stringify(mark)}, \`RV${n} \${BROKEN ? '改壞' : '原樣'}\\n\`);\n`
      + `await new Promise((r) => setTimeout(r, 2000));\nok(!BROKEN, 'RV${n} 探針');\ndone('rvtest${n}');\n`);
  }
  const mtFile = path.join(root, 'scripts/mutationtest.mjs');
  let src = fs.readFileSync(mtFile, 'utf8');
  const a0 = src.indexOf('const MUTATIONS = [\n'); const a1 = src.indexOf('\n];\n', a0);
  if (a0 < 0 || a1 < 0) throw new SetupError('mutationtest.mjs 找不到突變清單的頭尾');
  const muts = [1, 2, 3].map((n) => `  { name: "RV${n}", why: "x", file: "scripts/rvtarget${n}.mjs", find: "export const BROKEN = false;", replace: "export const BROKEN = true;", test: "rvtest${n}", expect: "RV${n} 探針" },`).join('\n');
  src = `${src.slice(0, a0)}const MUTATIONS = [\n${muts}${src.slice(a1)}`;
  if (variant === 'broken-recover') {
    const f = 'function recoverPending() {\n  if (!fs.existsSync(PENDING)) return null;';
    if (src.split(f).length !== 2) throw new SetupError('壞的還原：找不到 recoverPending 的開頭');
    src = src.replace(f, 'function recoverPending() {\n  return null;\n  if (!fs.existsSync(PENDING)) return null;');
  }
  if (variant === 'broken-resume') {
    // 真實會犯的錯：續跑時「從帳本裡最後一條的下一條之後」開始——多跳一條，剛好把中斷時正在跑的那一條靜默跳過
    const f = '  SELECTED = MUTATIONS.filter((m) => !doneAt(ledger.entries[m.name], COMMIT, curOf(m)));';
    if (src.split(f).length !== 2) throw new SetupError('壞的接續點：找不到整套續跑的那一行');
    src = src.replace(f, '  { const lastIdx = Math.max(-1, ...MUTATIONS.map((m, i) => (ledger.entries[m.name] ? i : -1))); SELECTED = lastIdx < 0 ? MUTATIONS : MUTATIONS.slice(lastIdx + 2); void doneAt; }');
  }
  if (variant === 'two-files') {
    // 第二支檔護欄的情境：還原之後不清還原紀錄（一個會讓「上一支還沒收尾就改下一支」的錯）——下一條要改檔時必須被拒絕
    const f = "      fs.writeFileSync(full, original, 'utf8');\n      clearPending();\n      ledger.inflight = null;";
    if (src.split(f).length !== 2) throw new SetupError('第二支檔護欄：找不到還原那一段');
    src = src.replace(f, "      fs.writeFileSync(full, original, 'utf8');\n      ledger.inflight = null;");
  }
  fs.writeFileSync(mtFile, src);
  const git = (...a) => execFileSync('git', ['-C', root, '-c', 'user.name=probe', '-c', 'user.email=probe@users.noreply.github.com', ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git('init', '-q'); git('add', '-A'); git('commit', '-q', '-m', 'resume-verify');
  return { root, mark, mtFile, target2: path.join(root, 'scripts/rvtarget2.mjs'), ledger: path.join(root, 'scripts/mutation-ledger.json'), pending: path.join(root, 'scripts/.mutation-pending.json'), commit: git('rev-parse', '--short=12', 'HEAD').trim() };
}

const env = () => { const e = { ...process.env }; for (const k of ['MM_AUDIT', 'MM_AUDIT_OUT', 'MM_LEDGER', 'MM_LOGDIR']) delete e[k]; return e; };
function runSync(repo, args) {
  try { return { code: 0, out: execFileSync(process.execPath, [repo.mtFile, ...args], { cwd: repo.root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: env() }) }; }
  catch (e) { return { code: e.status ?? -1, out: String(e.stdout ?? '') + String(e.stderr ?? '') }; }
}
const readLedger = (repo) => (fs.existsSync(repo.ledger) ? JSON.parse(fs.readFileSync(repo.ledger, 'utf8')) : { entries: {} });
const marks = (repo) => (fs.existsSync(repo.mark) ? fs.readFileSync(repo.mark, 'utf8').split('\n').filter(Boolean) : []);
const ranBroken = (lines, n) => lines.filter((l) => l === `RV${n} 改壞`).length;

/** 用 --full 開跑，等第一條記進帳本、第二條正在跑（改壞的檔在磁碟上、還原紀錄在）時 SIGKILL；回開跑後幾毫秒殺掉的 */
async function killMidSecond(repo) {
  const child = spawn(process.execPath, [repo.mtFile, '--full'], { cwd: repo.root, stdio: 'ignore', env: env() });
  const t0 = Date.now(); let killedAt = null;
  while (Date.now() - t0 < 120000) {
    await sleep(200);
    const led = readLedger(repo);
    const busy2 = fs.existsSync(repo.pending) && fs.readFileSync(repo.target2, 'utf8') !== ORIGINAL;
    if (led.entries?.RV1?.last?.counted && busy2) { await sleep(500); child.kill('SIGKILL'); killedAt = Date.now() - t0; break; }
    if (child.exitCode !== null) break;
  }
  if (killedAt === null) { child.kill('SIGKILL'); throw new SetupError(`等不到「第一條記進帳本、第二條正在跑」的時刻（${Math.round((Date.now() - t0) / 1000)} 秒）`); }
  await sleep(1500);
  if (!(fs.readFileSync(repo.target2, 'utf8') !== ORIGINAL && fs.existsSync(repo.pending))) {
    throw new SetupError('殺掉之後，第二條的目標檔不是改壞的狀態（或還原紀錄不在）——中斷的情境沒造成');
  }
  return killedAt;
}

/** 跑一次完整流程；回 [{ step, pass, detail }]（每一關一筆；造情境失敗丟 SetupError） */
async function flow(variant) {
  const repo = makeRepo(variant);
  const steps = [];
  const step = (name, pass, detail) => steps.push({ step: name, pass: !!pass, detail });
  try {
    // 1–2. 開跑、在第二條正在跑時真的殺掉（SIGKILL，不是旗標：被殺掉時 finally 不會跑）；確認第二條的目標檔留在改壞的狀態
    const killedAt = await killMidSecond(repo);
    step('前提：中斷時第二條的目標檔留在改壞的狀態', true, `開跑後約 ${Math.round(killedAt / 1000)} 秒殺掉`);
    // 3. 只續跑一條：還原（內容雜湊）＋沒收齊要點名
    fs.writeFileSync(repo.mark, '');
    const rA = runSync(repo, ['--full', '--limit', '1']);
    const restoredMsg = rA.out.includes('上一次被中斷，已還原 scripts/rvtarget2.mjs');
    const hashOk = sha(repo.target2) === crypto.createHash('sha256').update(ORIGINAL).digest('hex');
    const whyA = (rA.out.split('\n').find((l) => l.includes('✗')) ?? '').trim().slice(0, 200);
    step('還原：開頭說已還原、跑完後目標檔的內容雜湊等於原樣', restoredMsg && hashOk, `訊息 ${restoredMsg ? '有' : '沒有'}；雜湊 ${hashOk ? '相同' : '不同'}${restoredMsg && hashOk ? '' : `；執行器回 ${rA.code}、第一個 ✗：${whyA || '（沒有）'}`}`);
    const named = /整套還沒收齊：[^\n]*RV3/.test(rA.out);
    const ranA = marks(repo);
    step('續跑（第一段）：只跑了第二條；沒收齊時點名第三條', named && ranBroken(ranA, 1) === 0 && ranBroken(ranA, 2) === 1 && ranBroken(ranA, 3) === 0,
      `點名 ${named ? '有' : '沒有'}；這一段實際跑的改壞版本：RV1 ${ranBroken(ranA, 1)}、RV2 ${ranBroken(ranA, 2)}、RV3 ${ranBroken(ranA, 3)}`);
    // 4. 再續跑：只跑第三條、收齊、帳本三條都算數
    fs.writeFileSync(repo.mark, '');
    const rB = runSync(repo, ['--full']);
    const ranB = marks(repo);
    const led = readLedger(repo);
    const allCounted = ['RV1', 'RV2', 'RV3'].every((n) => led.entries?.[n]?.last?.counted === true && led.entries[n].last.red === true && led.entries[n].last.commit === repo.commit && led.entries[n].lastFull);
    const lastFullWritten = fs.existsSync(path.join(repo.root, 'scripts/mutation-lastfull.json'));
    step('續跑（第二段）：只跑了第三條；帳本三條都在同一個 commit 上算數、紅；寫了整套跑完的基準清單',
      ranBroken(ranB, 1) === 0 && ranBroken(ranB, 2) === 0 && ranBroken(ranB, 3) === 1 && allCounted && lastFullWritten && rB.out.includes('整套收齊：3 條'),
      `這一段實際跑的改壞版本：RV1 ${ranBroken(ranB, 1)}、RV2 ${ranBroken(ranB, 2)}、RV3 ${ranBroken(ranB, 3)}；帳本三條都算數 ${allCounted}；基準清單 ${lastFullWritten ? '寫了' : '沒寫'}`);
    step('收尾：工作區沒有留下改壞的檔', [1, 2, 3].every((n) => fs.readFileSync(path.join(repo.root, `scripts/rvtarget${n}.mjs`), 'utf8') === ORIGINAL) && !fs.existsSync(repo.pending), '');
  } finally {
    fs.rmSync(repo.root, { recursive: true, force: true }); fs.rmSync(repo.mark, { force: true });
  }
  return steps;
}

/**
 * 三道護欄（Dispatch 2026-10-02），每一道都有反向（該照跑的照跑——不然只是一道永遠拒絕的閘）：
 *   紀錄被移掉：兩處紀錄（帳本的 inflight、磁碟上的還原紀錄）對不上 → 拒絕、指出是哪一次；檔案已經是原樣時照跑
 *   護欄一 工作區：工作區不等於 HEAD → --full 拒絕並列出檔案；--only 照跑
 *   護欄一 --only：目標檔已經含「改壞後」的字串、HEAD 沒有 → 拒絕
 *   第二支：還原紀錄還在時要改第二支檔 → 拒絕
 */
async function guardFlow() {
  const steps = [];
  const step = (name, pass, detail) => steps.push({ step: name, pass: !!pass, detail });
  const git = (repo, ...a) => execFileSync('git', ['-C', repo.root, '-c', 'user.name=probe', '-c', 'user.email=probe@users.noreply.github.com', ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const cleanup = (repo) => { fs.rmSync(repo.root, { recursive: true, force: true }); fs.rmSync(repo.mark, { force: true }); };
  const BROKEN_TEXT = 'export const BROKEN = true;\n';
  // 紀錄被移掉：真的殺掉之後刪掉還原紀錄
  {
    const repo = makeRepo('normal');
    try {
      await killMidSecond(repo);
      const brokenHash = sha(repo.target2);
      fs.rmSync(repo.pending);
      const r = runSync(repo, ['--full']);
      step('護欄 紀錄被移掉：還原紀錄被刪、帳本留著「開跑未完成」→ 拒絕、指出第幾次與哪支檔、不動那支檔',
        r.code !== 0 && r.out.includes('還原紀錄卻不見了') && r.out.includes('第 1 次開跑') && r.out.includes('scripts/rvtarget2.mjs') && sha(repo.target2) === brokenHash,
        `回 ${r.code}；${(r.out.split('\n').find((l) => l.includes('✗')) ?? '（沒有 ✗）').trim().slice(0, 140)}`);
      // 行尾：人工還原時寫成 CRLF（內容跟改壞前一樣）→ 兩處紀錄那一關要判成「已是原樣」（只比內容、不比行尾）；
      // 接著工作區不等於 HEAD（git 把 CRLF 的檔當成有改動），由護欄一擋下——兩種結果分得出是哪一關
      fs.writeFileSync(repo.target2, ORIGINAL.replace(/\n/g, '\r\n'));
      const rEol = runSync(repo, ['--full']);
      step('護欄 紀錄被移掉（行尾）：人工還原成 CRLF、內容等於改壞前 → 判成已還原（不判成「紀錄不見了」），接著由護欄一擋下',
        rEol.code !== 0 && rEol.out.includes('當成已還原') && rEol.out.includes('工作區不等於 HEAD') && !rEol.out.includes('還原紀錄卻不見了'),
        `回 ${rEol.code}；第一個 ✗：${(rEol.out.split('\n').find((l) => l.includes('✗')) ?? '（沒有）').trim().slice(0, 120)}`);
      git(repo, 'checkout', '--', 'scripts/rvtarget2.mjs');            // 人工確認後把它還原
      const r2 = runSync(repo, ['--full']);
      step('護欄 紀錄被移掉（反向）：人工還原後（檔案雜湊等於改壞前）→ 照跑、收齊',
        r2.code === 0 && r2.out.includes('當成已還原') && r2.out.includes('整套收齊：3 條'), `回 ${r2.code}；第一個 ✗：${(r2.out.split('\n').find((l) => l.includes('✗')) ?? '（沒有）').trim().slice(0, 200)}；有沒有「當成已還原」：${r2.out.includes('當成已還原')}`);
    } finally { cleanup(repo); }
  }
  // 護欄一 工作區／--only
  {
    const repo = makeRepo('normal');
    try {
      const t1 = path.join(repo.root, 'scripts/rvtarget1.mjs');
      fs.writeFileSync(t1, `${ORIGINAL}// 合成：一個還沒 commit 的改動\n`);
      const r = runSync(repo, ['--full']);
      step('護欄一 工作區：工作區不等於 HEAD → --full 拒絕、列出那支檔', r.code !== 0 && r.out.includes('工作區不等於 HEAD') && r.out.includes('scripts/rvtarget1.mjs'), `回 ${r.code}`);
      const r2 = runSync(repo, ['--only', 'RV1']);
      step('護欄一 工作區（反向）：同樣有改動，--only 照跑（寫新斷言的流程）', r2.code === 0 && r2.out.includes('選了 1 條突變'), `回 ${r2.code}`);
      fs.writeFileSync(t1, BROKEN_TEXT);
      const readBack = fs.readFileSync(t1, 'utf8') === BROKEN_TEXT;          // 造樣本後讀回確認（v11.3 §5.20）
      const r3 = runSync(repo, ['--only', 'RV1']);
      step('護欄一 --only：目標檔已經是改壞後的樣子（HEAD 沒有）→ 拒絕、點名那支檔',
        readBack && r3.code !== 0 && r3.out.includes('已經是改壞後的樣子') && r3.out.includes('scripts/rvtarget1.mjs'), `樣本讀回 ${readBack}；回 ${r3.code}`);
    } finally { cleanup(repo); }
  }
  // 第二支：還原之後不清還原紀錄的那一版，改第二條的檔時必須被拒絕
  {
    const repo = makeRepo('two-files');
    try {
      const r = runSync(repo, ['--full']);
      step('護欄 第二支：還原紀錄還在時要改第二支檔 → 拒絕；第二支檔沒被改',
        r.code !== 0 && r.out.includes('一次只准一支') && fs.readFileSync(repo.target2, 'utf8') === ORIGINAL, `回 ${r.code}`);
    } finally { cleanup(repo); }
  }
  return steps;
}

const print = (title, steps) => { console.log(`\n— ${title} —`); for (const s of steps) console.log(`  ${s.pass ? '✓' : '✗'} ${s.step}${s.detail ? `（${s.detail}）` : ''}`); };
const firstFail = (steps) => steps.find((s) => !s.pass)?.step ?? null;

let code = 0;
try {
  const normal = await flow('normal');
  print('正常流程', normal);
  if (firstFail(normal)) code = 1;
  // 對照組：每一個都要在預期那一關報不符（抓在別關不算）
  const controls = [['broken-recover', '還原：'], ['broken-resume', '續跑（第一段）']];
  for (const [variant, expectAt] of controls) {
    const steps = await flow(variant);
    print(`對照組：${variant}`, steps);
    const ff = firstFail(steps);
    const ok = ff !== null && ff.startsWith(expectAt);
    console.log(`  ${ok ? '✓' : '✗'} 對照組 ${variant} 在「${expectAt}」那一關報不符（實際第一個不符：${ff ?? '沒有任何一關不符'}）`);
    if (!ok && code === 0) code = 2;
  }
  const guards = await guardFlow();
  print('護欄（每一道都有反向）', guards);
  if (firstFail(guards) && code === 0) code = 1;
} catch (e) {
  console.log(`\n✗ 造情境失敗：${e.message}`);
  code = e instanceof SetupError ? 3 : 1;
}
console.log(`\nresume-verify：${code === 0 ? '全部符合' : `不符（回 ${code}）`}`);
process.exit(code);

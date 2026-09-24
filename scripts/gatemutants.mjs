// 推送閘門與閘門驗法的突變、失敗路徑驗法（2026-09-24；F10 四家統一做法）。
// 以前這些突變是 session 暫存區裡的一次性腳本，session 一沒了就不能重跑；收進 repo，改過閘門或閘門驗法就跟 pushgate-verify 一起跑。
//
// 每一條：在 repo 外的拋棄式 worktree 把指定的那一支檔改壞一處（或不改）、commit → 確認跑到的是改壞的那一版 →
// （選填）在 PATH 最前面放假 git，先驗假 git 自己的對照組（指定的子指令必須失敗、不相干的必須照常）→ 跑指定的驗法 →
// 比對「不符合的是哪幾種」要恰好等於預期、回傳值與理由要對（多紅、少紅、紅錯地方、被後面接住但理由不對，都算不如預期）。
// 不在正式程式裡留「設了某個變數就故意失敗」的後門（F10）：失敗一律由假指令從外面造。
// 用法（在 repo 根目錄，改完先 commit）：node scripts/gatemutants.mjs。全部如預期回 0，否則回 1。
// 耗時：每一條跑一次整套閘門驗法（約 60–90 秒）或一次 gatescan（幾秒）。
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const GATE = 'scripts/pushgate.sh';
const VERIFY = 'scripts/pushgate-verify.sh';
/** 假 git：args 同時含 failWhen 裡每一個時失敗，其他照常 */
const FAKE_DIFF = ['-p', '--no-color', '-U0'];

/**
 * { label, file（預設閘門）, find（null＝不改）, replace, fakeGit（選填：失敗條件）, runner（'verify' 預設｜'gatescan'）,
 *   order（選填：閘門驗法的順序）, expect（verify：預期不符合的情境編號）, must／mustNot（選填：輸出裡一定要有／不能有的字）, exit（選填） }
 */
export const CASES = [
  { label: '對照：原樣', find: null, expect: [] },
  // ---- 閘門第零關之二（F8 驗法登記，F9）----
  { label: '拿掉第零關之二（F8 驗法登記）整段', find: 'BLOCK_0B', replace: '', expect: ['15', '16', '17', '18', '19', '20'] },
  { label: '取不到檔名清單時不停（失敗照樣往下走）', find: 'if ! git log --format= --name-only "$REMOTE/main..HEAD" > "$LOG" 2>&1; then cat "$LOG"; echo "【擋下：F8 驗法登記】取不到這次要推的檔名清單，不知道有沒有動到被守的檔，不推送"; exit 5; fi',
    replace: 'git log --format= --name-only "$REMOTE/main..HEAD" > "$LOG" 2>&1', expect: ['20'] },
  { label: '不管有沒有動到都看登記（新 clone 一律要先跑）', find: 'if [ -z "$bgtouched" ]; then', replace: 'if false; then', expect: ['17'] },
  { label: '比工作區、不比已 commit 版本', find: 'h="$(git rev-parse "HEAD:$f" 2>/dev/null)"', replace: 'h="$(git hash-object "$f" 2>/dev/null)"', expect: ['18'] },
  { label: '只看最後一個 commit 的檔名', find: 'git log --format= --name-only "$REMOTE/main..HEAD"', replace: 'git log -1 --format= --name-only HEAD', expect: ['19'] },
  // ---- 閘門第一關：讀不到遠端（F10：第 21 種用假 git 讓 fetch 失敗）----
  { label: '讀不到遠端時不停（fetch 失敗照樣往下走）', find: 'if ! git fetch -q "$REMOTE" main > "$LOG" 2>&1; then cat "$LOG"; echo "【擋下：自查】讀不到遠端，自查的範圍不確定，不推送"; exit 1; fi',
    replace: 'git fetch -q "$REMOTE" main > "$LOG" 2>&1', expect: ['21'] },
  // ---- 閘門驗法第 11 種的失敗路徑（F10：假 git 讓取 diff 那一個子指令失敗）----
  { label: '失敗路徑：第 11 種取不到 diff → 明講、判不符合', find: null, fakeGit: FAKE_DIFF,
    expect: ['11'], must: '11 ++ 開頭的新增行｜取不到 diff｜不符合（情境沒造成，中止）' },
  { label: '突變：拿掉「取不到 diff 就明講」→ 被後面的前置斷言接住、理由不對（算紅）', file: VERIFY, fakeGit: FAKE_DIFF,
    find: '  if ! git log -p --no-color --format= -U0 origin/main..HEAD > "$T/k.diff"; then echo "11 ++ 開頭的新增行｜取不到 diff｜不符合（情境沒造成，中止）"; FAIL=1; fi',
    replace: '  git log -p --no-color --format= -U0 origin/main..HEAD > "$T/k.diff"',
    expect: ['11'], must: '11 ++ 開頭的新增行｜前置不成立', mustNot: '取不到 diff' },
  // ---- 擋法表（2026-09-25，F9 補）：每一種必備情境一條只紅它的突變；共用的一環另列一條 ----
  { label: '擋法表｜2 自查的對照組沒命中就停 → 拿掉', file: 'scripts/selfcheck.mjs', find: '    if (!ctl) ok = false;', replace: '    void ctl;', expect: ['2'] },
  { label: '擋法表｜3 取不到使用者名稱就丟例外 → 改成回 false（隱式：被對照組接住、理由不對）', file: 'scripts/selfcheck.mjs',
    find: "{ test: () => { throw new Error('取不到使用者名稱'); } }", replace: '{ test: () => false }', expect: ['3'] },
  { label: '擋法表｜4 範圍裡沒有 commit 就停 → 拿掉', file: 'scripts/selfcheck.mjs', find: '  if (commits.length === 0) {', replace: '  if (false) {', expect: ['4'] },
  { label: '擋法表｜5 推送失敗就停 → 拿掉（隱式：被第三關接住、回傳值不對）', find: 'if [ "$rc" -ne 0 ]; then echo "【擋下：推送失敗】', replace: 'if false; then echo "【擋下：推送失敗】', expect: ['5'] },
  { label: '擋法表｜6 遠端與本機不一樣 → 改成只在讀不到時才擋', find: 'if [ "$REMOTE_SHA" != "$HEAD_SHA" ]; then', replace: 'if [ -z "$REMOTE_SHA" ]; then', expect: ['6'] },
  { label: '擋法表｜22 讀不到遠端的 main（隱式：空值≠本機）→ 改成讀不到就當成一樣', find: 'if [ "$REMOTE_SHA" != "$HEAD_SHA" ]; then', replace: 'if [ -n "$REMOTE_SHA" ] && [ "$REMOTE_SHA" != "$HEAD_SHA" ]; then', expect: ['22'] },
  { label: '擋法表｜共同的一環：第三關的比對（6、22 共用）→ 整段拿掉', find: 'if [ "$REMOTE_SHA" != "$HEAD_SHA" ]; then', replace: 'if false; then', expect: ['6', '22'] },
  { label: '擋法表｜8 範圍照遠端的實際狀態算（fetch 更新追蹤分支）→ 改成 --dry-run（照樣連得到遠端、但不更新）', find: 'if ! git fetch -q "$REMOTE" main > "$LOG" 2>&1; then', replace: 'if ! git fetch -q --dry-run "$REMOTE" main > "$LOG" 2>&1; then', expect: ['8'] },
  { label: '擋法表｜9 commit 訊息要取 → 不取 %B', file: 'scripts/selfcheck.mjs', find: "'--format=%B%n%an <%ae>%n%cn <%ce>'", replace: "'--format=%an <%ae>%n%cn <%ce>'", expect: ['9'] },
  { label: '擋法表｜10 作者與提交者信箱要取 → 不取 %ae、%ce', file: 'scripts/selfcheck.mjs', find: "'--format=%B%n%an <%ae>%n%cn <%ce>'", replace: "'--format=%B%n%an%n%cn'", expect: ['10'] },
  { label: '擋法表｜共同的一環：訊息與作者欄命中就停（9、10 共用）→ 拿掉', file: 'scripts/selfcheck.mjs', find: '    if (inMeta) {', replace: '    if (false) {', expect: ['9', '10'] },
  { label: '擋法表｜11 照 diff 結構抽新增行 → 改回「以 +++ 開頭就跳過」（隱式：被 numstat 核對接住、理由不對）', file: 'scripts/selfcheck.mjs',
    find: "    if (inHunk && l.startsWith('+')) out.push(l.slice(1));", replace: "    if (l.startsWith('+') && !l.startsWith('+++')) out.push(l.slice(1));", expect: ['11'] },
  { label: '擋法表｜共同的一環：新增行命中就停（1、8、11 共用；1 本身就是這一環）→ 拿掉', file: 'scripts/selfcheck.mjs', find: '    if (inAdded) {', replace: '    if (false) {', expect: ['1', '8', '11'] },
  { label: '擋法表｜12 只刪不增要放行 → 新增行 0 當成故障', file: 'scripts/selfcheck.mjs', find: '  if (added.length !== numstat) {', replace: '  if (added.length !== numstat || added.length === 0) {', expect: ['12'] },
  { label: '擋法表｜13 閘門改過沒重跑驗法 → 不比登記', find: 'if [ "$(cat "$REG")" != "$(printf \'%s\' "$cur")" ]; then', replace: 'if false; then', expect: ['13'] },
  { label: '擋法表｜14 沒有登記檔 → 拿掉（隱式：被比對接住、理由不對）', find: 'if [ ! -f "$REG" ]; then', replace: 'if false; then', expect: ['14'] },
  { label: '擋法表｜共同的一環：第零關之二的比對（15、19 共用；15 本身就是這一環）→ 拿掉', find: '  if [ "$(cat "$BGREG")" != "$(printf \'%s\' "$bgcur")" ]; then', replace: '  if false; then', expect: ['15', '19'] },
  { label: '擋法表｜16 沒有 F8 的登記檔 → 拿掉（隱式：被比對接住、理由不對）', find: '  if [ ! -f "$BGREG" ]; then', replace: '  if false; then', expect: ['16'] },
  { label: '擋法表｜共同的一環：自查放行（5、6 要先過自查才走得到推送那一關；7、12、17、18、22 要推得上去）→ 自查一律判不通過', file: 'scripts/selfcheck.mjs', find: '  return ok;', replace: '  return false;', expect: ['5', '6', '7', '12', '17', '18', '22'] },
  { label: '擋法表｜共同的一環：閘門驗法的 check 比對理由 → 不比對，再拿掉 14 的守衛：14 會變成「符合」（這一環是 5、11、14、16 等隱式情境能紅的前提）', file: VERIFY,
    find: '  grep -q -- "$must" "$T/out" || outOk=no', replace: '  true', also: [{ file: GATE, find: 'if [ ! -f "$REG" ]; then', replace: 'if false; then' }], expect: [] },
  // ---- 改閘門驗法本身的（以前的 M4、M6）----
  { label: 'M6：fresh 不清 hook（預設順序看得出來）', file: VERIFY,
    find: 'fresh() { rm -f "$T/remote.git/hooks/pre-receive" "$T/remote.git/hooks/post-receive"; restore_all; register_work; }',
    replace: 'fresh() { restore_all; register_work; }', expect: ['6', '7', '12', '17', '18', '22'] },
  { label: 'M4：第 11 種前置斷言改回接管線 → gatescan 點名那一行', file: VERIFY, runner: 'gatescan',
    find: `  PP="$(grep -c '^+++ ' "$T/k.diff")"`, replace: `  PP="$(git log -p --no-color --format= -U0 origin/main..HEAD | grep -c '^+++ ')"`,
    must: '｜pipe｜' },
];
const B0_START = '# 第零關之二：F8 驗法登記';
const B0_END = 'node scripts/selfcheck.mjs "$REMOTE" > "$LOG" 2>&1';

/**
 * 從閘門驗法的輸出抽出每一種的結論：{ total: 出現過的情境數, bad: 有任何一行判不符合的情境編號 }。
 * 「不符合」不一定在行尾：情境沒造成時是「…｜不符合（情境沒造成，中止）」——只認行尾的話，這種會被漏掉（2026-09-24 寫失敗路徑時發現）。
 */
export function verdictsOf(out) {
  const seen = new Set(); const bad = new Set();
  for (const l of String(out).split('\n')) {
    const m = /^(\d+) .*｜(不符合|符合)(（[^）]*）)?$/.exec(l);
    if (!m) continue;
    seen.add(m[1]); if (m[2] === '不符合') bad.add(m[1]);
  }
  return { total: seen.size, bad: [...bad].sort((a, b) => a - b) };
}

export function mutate(src, c) {
  if (c.find === 'BLOCK_0B') {
    const a = src.indexOf(B0_START), b = src.indexOf(B0_END);
    if (a < 0 || b < a || src.split(B0_START).length !== 2) return null;
    return src.slice(0, a) + src.slice(b);
  }
  if (src.split(c.find).length !== 2) return null;
  return src.replace(c.find, () => c.replace);
}

/** 環境變數：Windows 上 PATH 的鍵名是 Path，另外加一個 PATH 會變成兩個，要沿用原本的鍵名 */
function envWithPath(prefixDir) {
  const env = { ...process.env };
  const key = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
  if (prefixDir) env[key] = `${prefixDir}${path.delimiter}${env[key] ?? ''}`;
  return env;
}

/** 假 git：args 同時含 failWhen 的每一個就回 128，其他交給真的 git。回假 git 所在的資料夾。 */
export function makeFakeGit(failWhen) {
  const real = spawnSync('bash', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
  if (!real) throw new Error('找不到真的 git');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-fakegit-'));
  const conds = failWhen.map((w) => `has ${JSON.stringify(w)}`).join(' && ');
  fs.writeFileSync(path.join(dir, 'git'), `#!/usr/bin/env bash
has() { local x; for x in "\${ARGS[@]}"; do [ "$x" = "$1" ] && return 0; done; return 1; }
ARGS=("$@")
if ${conds}; then echo "fake git：故意失敗（${failWhen.join(' ')}）" >&2; exit 128; fi
exec ${JSON.stringify(real)} "$@"
`);
  fs.chmodSync(path.join(dir, 'git'), 0o755);
  return dir;
}

/** 假 git 自己的對照組（F10）：指定的子指令必須失敗；不相干的、同一個子指令不帶那些旗標的，都必須照常。 */
export function fakeControls(wt, fakeDir, failWhen) {
  const run = (cmd) => spawnSync('bash', ['-c', cmd], { cwd: wt, encoding: 'utf8', env: envWithPath(fakeDir) });
  const real = (cmd) => spawnSync('bash', ['-c', cmd], { cwd: wt, encoding: 'utf8' });
  const target = run(`git log ${failWhen.join(' ')} --format= -1 HEAD`);
  const head = real('git rev-parse HEAD').stdout.trim();
  const unrelated = run('git rev-parse HEAD').stdout.trim();
  const sameSub = run('git log -1 --format=%H HEAD').stdout.trim();
  const out = [
    { ok: target.status !== 0 && /fake git：故意失敗/.test(target.stderr), label: `指定的子指令（git log ${failWhen.join(' ')}）失敗（回傳 ${target.status}）` },
    { ok: head.length === 40 && unrelated === head, label: '不相干的 git rev-parse 照常' },
    { ok: head.length === 40 && sameSub === head, label: '同一個 log 子指令、不帶那些旗標照常' },
  ];
  return out;
}

function runCase(repo, origHead, c, expectedTotal) {
  const wt = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-gatemut-'));
  fs.rmSync(wt, { recursive: true });
  execFileSync('git', ['-C', repo, 'worktree', 'add', '-q', '--detach', wt, 'HEAD']);
  let fakeDir = null;
  try {
    let head = origHead;
    if (c.find !== null) {
      // 一條突變可以改好幾處（also）：每一處都要剛好一次、都要真的進了 commit
      const muts = [{ file: c.file ?? GATE, find: c.find, replace: c.replace }, ...(c.also ?? [])];
      const outs = [];
      for (const m of muts) {
        const p = path.join(wt, m.file);
        const out = mutate(fs.readFileSync(p, 'utf8'), m);
        if (out === null) return { ok: false, line: `【${c.label}】${m.file} 的錨點不是剛好一次（改過了？更新這一條）｜不如預期` };
        fs.writeFileSync(p, out);
        outs.push([m.file, out]);
      }
      execFileSync('git', ['-C', wt, '-c', 'user.name=probe', '-c', 'user.email=probe@users.noreply.github.com', 'commit', '-q', '-am', `mutant: ${c.label}`]);
      head = execFileSync('git', ['-C', wt, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
      for (const [rel, out] of outs) {
        const committed = execFileSync('git', ['-C', wt, 'show', `HEAD:${rel}`], { encoding: 'utf8' });
        if (head === origHead || committed !== out) return { ok: false, line: `【${c.label}】跑到的不是改壞的那一版（${rel}）｜不如預期` };
      }
    }
    if (c.fakeGit) {
      fakeDir = makeFakeGit(c.fakeGit);
      const fc = fakeControls(wt, fakeDir, c.fakeGit);
      if (!fc.every((x) => x.ok)) return { ok: false, line: `【${c.label}】假 git 的對照組不對：${fc.filter((x) => !x.ok).map((x) => x.label).join('；')}｜不如預期（沒證明是那個子指令）` };
    }
    const env = envWithPath(fakeDir);
    if (c.order) env.PUSHGATE_VERIFY_ORDER = c.order;
    if ((c.runner ?? 'verify') === 'gatescan') {
      const r = spawnSync(process.execPath, ['scripts/gatescan.mjs'], { cwd: wt, encoding: 'utf8', env });
      const text = r.stdout + r.stderr;
      const hits = text.split('\n').filter((l) => l.startsWith('命中｜'));
      const ok = r.status === 1 && hits.length === 1 && (!c.must || hits[0].includes(c.must));
      return { ok, line: `【${c.label}】HEAD ${head.slice(0, 7)}｜gatescan 回傳 ${r.status}（預期 1）｜命中 ${hits.length} 處（預期 1）：${hits.map((h) => h.slice(0, 80)).join(' ／ ') || '無'}｜${ok ? '如預期' : '不如預期'}` };
    }
    const r = spawnSync('bash', [VERIFY], { cwd: wt, encoding: 'utf8', env });
    const text = r.stdout + r.stderr;
    const v = verdictsOf(text);
    const wantExit = c.exit ?? (c.expect.length ? 1 : 0);
    const mustOk = !c.must || text.includes(c.must);
    const mustNotOk = !c.mustNot || !text.includes(c.mustNot);
    const totalOk = v.total > 0 && (expectedTotal === null || v.total === expectedTotal);
    const ok = totalOk && v.bad.join(',') === c.expect.join(',') && r.status === wantExit && mustOk && mustNotOk;
    return { ok, total: v.total, line: `【${c.label}】HEAD ${head.slice(0, 7)}｜回傳 ${r.status}（預期 ${wantExit}）｜${v.total} 種、不符合：${v.bad.join('、') || '無'}（預期：${c.expect.join('、') || '無'}）${c.must || c.mustNot ? `｜理由${mustOk && mustNotOk ? '對' : '不對'}` : ''}｜${ok ? '如預期' : '不如預期'}` };
  } finally {
    execFileSync('git', ['-C', repo, 'worktree', 'remove', '--force', wt]);
    if (fakeDir) fs.rmSync(fakeDir, { recursive: true, force: true });
  }
}

function main() {
  // 擷取的對照組：抓空的話，「不符合的恰好是預期那幾種」會退化成永遠「沒有不符合」
  const sample = '15 動到 build｜回傳 0（預期 5）｜假遠端 a → a（預期 same）｜不符合\n7 全部正常｜回傳 0（預期 0）｜假遠端 a → b（預期 local）｜符合\n'
    + '11 ++ 開頭的新增行｜取不到 diff｜不符合（情境沒造成，中止）\n閘門驗法：…';
  const sv = verdictsOf(sample);
  if (sv.total !== 3 || sv.bad.join(',') !== '11,15') { console.log('gatemutants：擷取的對照組不對（檢查器壞了），不往下跑'); return 1; }
  const repo = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  const origHead = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  // 假 git 對照組本身的對照（兩個方向）：好的假 git（只讓 -p -U0 那一種失敗）要三項都過；
  // 太粗的假 git（整個 log 子指令都失敗）要被「同一個 log 子指令不帶那些旗標要照常」那一項抓到——否則對照組是擺設
  const good = makeFakeGit(FAKE_DIFF), coarse = makeFakeGit(['log']);
  try {
    const g = fakeControls(repo, good, FAKE_DIFF), c = fakeControls(repo, coarse, ['log']);
    const goodOk = g.every((x) => x.ok), coarseCaught = !c[2].ok && c[0].ok && c[1].ok;
    console.log(`假 git 的對照組｜好的假 git 三項都過：${goodOk}｜太粗的假 git（整個 log 都失敗）被抓到：${coarseCaught}`);
    if (!goodOk || !coarseCaught) { console.log('gatemutants：假 git 的對照組不對（檢查器壞了），不往下跑'); return 1; }
  } finally { fs.rmSync(good, { recursive: true, force: true }); fs.rmSync(coarse, { recursive: true, force: true }); }
  let bad = 0; let expectedTotal = null;
  for (const c of CASES) {
    const res = runCase(repo, origHead, c, expectedTotal);
    if (c.find === null && !c.fakeGit && !c.order && (c.runner ?? 'verify') === 'verify') expectedTotal = res.total ?? null;
    if (!res.ok) bad += 1;
    console.log(res.line);
  }
  console.log(bad ? `gatemutants：${bad} 條不如預期` : `gatemutants：${CASES.length} 條全部如預期（對照 ${expectedTotal} 種全部符合；每一條只紅在預期的地方）`);
  return bad ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main();

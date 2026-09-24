// 掃推送閘門、自查、驗法有沒有已知的壞寫法（共用慣例 v9 §5.16；2026-09-24）。
// 規則寫下、甚至親手修過，下一次寫新程式還是會寫出舊寫法——所以做成機器掃得到的，每版都跑（由 doctest 呼叫）。
//
// · 掃的對象用登記制（§5.2）：清單寫死在 TARGETS，不掃「scripts/ 全部扣掉例外」。讀不到或讀到空的 → 停（檢查器壞了，不是 0 個問題）。
// · 六種寫法（§5.16）；註解行不算。後兩種是初篩：命中的逐條看過，合理的列進 EXCEPTIONS（檔案、哪一種、那一行的特徵字串、理由）。
// · 對照組（§5.3）：每一種都有當場組出來的合成樣本，另外加本 App 歷史上真的寫過的壞寫法原文；任何一種沒抓到 → 檢查器壞了。
// · 登記了卻沒用到的例外也算失敗（那一行改掉了，例外就該拿掉，不然清單會爛掉）。
// 回傳值：0 通過；1 有沒登記的命中、對照組沒抓到、登記的例外沒用到、或讀不到被掃的檔。
// 用法：node scripts/gatescan.mjs

import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

/** 登記制：只掃這幾支（推送閘門、公開前自查、閘門驗法）。 */
export const TARGETS = ['scripts/pushgate.sh', 'scripts/selfcheck.mjs', 'scripts/pushgate-verify.sh'];

const isComment = (l) => /^\s*(#|\/\/|\*)/.test(l);
// 管線：去掉 `||` 之後還有 `|`
const hasPipe = (l) => l.replace(/\|\|/g, '').includes('|');

/**
 * 逐行的寫法：{ id, desc, when（選填：整行還要成立的條件）, branches: [{ name, re（或 fn）, sample }] }。
 * 一行只要命中任一個分支（且 when 成立）就算。每個分支配一個自己的對照樣本（2026-09-25 補充說明十一第 3 點）：
 * 自我檢查逐一拿掉每個分支，它的樣本就必須抓不到——證明那個樣本真的打到那個分支，不是被別的分支順便抓到。
 * 樣本一律當場組出來（`P` 是管線符號、`BS` 是反斜線），不把會被自查或 gatescan 抓到的字面寫進原始碼。
 */
const P = '|';
const BS = String.fromCharCode(92);
// grep／sed 後面某個引號裡的樣式含反斜線
const quotedPatternHasBackslash = (tool, q) => (l) => [...l.matchAll(new RegExp(`\\b${tool}\\b[^|;]*?${q}([^${q}]*)${q}`, 'g'))].some((m) => m[1].includes(BS));
export const LINE_RULES = [
  { id: 'pipe', desc: '自查、推送、取遠端狀態、取 diff 的那一行後面接管線', when: (l) => hasPipe(l),
    branches: [
      { name: 'selfcheck', re: /selfcheck/, sample: 'node scripts/selfcheck.mjs ' + P + ' tail -1' },
      { name: 'git push', re: /\bgit\s+push\b/, sample: 'git push -q origin main 2>&1 ' + P + ' tail -1' },
      { name: 'git ls-remote', re: /\bgit\s+ls-remote\b/, sample: 'REMOTE_SHA="$(git ls-remote origin refs/heads/main ' + P + ' cut -f1)"' },
      { name: 'git fetch', re: /\bgit\s+fetch\b/, sample: 'git fetch -q origin main 2>&1 ' + P + ' tail -1' },
      { name: 'git log', re: /\bgit\s+log\b/, sample: 'git log -p --format= origin/main..HEAD ' + P + ' grep -c x' },
      { name: 'git diff', re: /\bgit\s+diff\b/, sample: 'git diff --cached ' + P + ' wc -l' },
      { name: 'git show', re: /\bgit\s+show\b/, sample: 'git show HEAD ' + P + ' head -5' },
    ] },
  { id: 'or-true', desc: '`|| true`（失敗照樣往下走）',
    branches: [{ name: '|| true', re: /\|\|\s*true\b/, sample: 'git push -q origin main ' + P + P + ' true' }] },
  { id: 'empty-catch', desc: '空的 catch',
    branches: [
      { name: 'catch {}', re: /catch\s*\{\s*\}/, sample: 'try { run(); } catch ' + '{}' },
      { name: 'catch (e) {}', re: /catch\s*\([^)]*\)\s*\{\s*\}/, sample: 'try { run(); } catch (e) ' + '{ }' },
    ] },
  { id: 'plus3-header', desc: '用「以 +++ 開頭」判斷 diff 檔頭',
    branches: [
      { name: "startsWith('+++')", re: /startsWith\(\s*['"]\+\+\+/, sample: "const added = diff.split('\\n').filter(l => l.startsWith('+') && !l.startsWith('" + '+++' + "'));" }, // 歷史：2026-09-23 以前的自查
      { name: "'^+++'", re: /['"]\^\+\+\+/, sample: "grep -v '^" + '+++' + "' diff.txt" },
    ] },
  { id: 'absence', desc: '斷言「不存在」（初篩：要先確認它原本在）',
    branches: [
      { name: '!fs.existsSync(', re: /!\s*fs\.existsSync\(/, sample: 'ok(!fs.existsSync(' + "reg), '登記刪掉了')" },
      { name: '[ ! -f', re: /\[\s*!\s+-f\s/, sample: 'if [ ! -f "$REG" ]; then' },
      { name: '[ ! -e', re: /\[\s*!\s+-e\s/, sample: 'if [ ! -e "$OUT" ]; then echo ok; fi' },
      { name: '不見了', re: /不見了/, sample: "console.log('登記檔' + '不見了')" },
      { name: '還在嗎', re: /還在嗎/, sample: "console.log('登記檔' + '還在嗎：' + regLeft)" },
      { name: 'mustNot', re: /mustNot/, sample: 'local ' + 'mustNot="$5"' },
    ] },
  { id: 'shell-regex', desc: 'grep／sed 的樣式含反斜線、寫在 shell 指令列上（初篩：同一次執行裡要跑過對照組）',
    // 只看 grep／sed 後面那個引號裡的樣式（2026-09-24：原本整行有反斜線就算，`printf "%s\n" … | grep -qE "^[1-9]"` 被誤報）
    branches: [
      { name: "grep '…'", fn: quotedPatternHasBackslash('grep', "'"), sample: "grep -E '^" + BS + "s+foo' out.txt" },
      { name: 'grep "…"', fn: quotedPatternHasBackslash('grep', '"'), sample: 'grep -E "^' + BS + 's+foo" out.txt' },
      { name: "sed '…'", fn: quotedPatternHasBackslash('sed', "'"), sample: "sed -i 's/" + BS + "bx/y/' f" },
      { name: 'sed "…"', fn: quotedPatternHasBackslash('sed', '"'), sample: 'sed -i "s/' + BS + 'bx/y/" f' },
    ] },
];
const branchHit = (b, l) => (b.fn ? b.fn(l) : b.re.test(l));
/** 這一行命中這條規則嗎（skip：假裝拿掉的那個分支名，自我檢查用） */
export function ruleHits(r, l, skip = null) {
  if (r.when && !r.when(l)) return false;
  return r.branches.some((b) => b.name !== skip && branchHit(b, l));
}
for (const r of LINE_RULES) r.test = (l) => ruleHits(r, l);

/**
 * 分支的自我檢查（每次跑 gatescan 都做）：回 [{ rule, branch, caught, soleCaught }]。
 * caught＝完整規則抓得到這個分支的樣本；soleCaught＝拿掉這個分支之後就抓不到（樣本真的靠這個分支）。兩個都要成立。
 */
export function branchSelfCheck() {
  const out = [];
  for (const r of [...LINE_RULES, ...FILE_RULES]) for (const b of r.branches) {
    out.push({ rule: r.id, branch: b.name, caught: ruleHits(r, b.sample), soleCaught: !ruleHits(r, b.sample, b.name) });
  }
  return out;
}

/** 整支檔案的寫法：用 --format= 取新增行，卻沒有另外取 commit 訊息與作者欄。 */
/**
 * 讀環境變數（2026-09-25，v10 候選「正式閘門不讀測試用環境變數」；Yolin 核准先做）：
 * TARGETS 裡讀了、卻沒在同一支檔裡賦值、也沒登記在 ENV_ALLOW 的環境變數，一律報出來。
 * 起因：pushgate.sh 讀 PUSHGATE_REMOTE（整個 repo 沒人用）——設了它，fetch、自查範圍、推送會一起改指到別的遠端，閘門照樣說通過。
 * shell：讀＝`$NAME`／`${NAME`（大寫開頭）；賦值＝`NAME=`（含 local／export、指令前綴）。JS：`process.env.NAME`、`process.env['NAME']`。
 * 登記的每一條都要真的用到，否則算失敗。
 */
export const ENV_ALLOW = [
  { file: 'scripts/selfcheck.mjs', name: 'USERNAME', reason: '取本機使用者名稱當成個資樣式（Windows）；取不到就丟例外（閘門驗法第 3 種）' },
  { file: 'scripts/selfcheck.mjs', name: 'USER', reason: '同上（其他平台）' },
  { file: 'scripts/pushgate.sh', name: '(間接:compgen -e)', reason: '入口拒絕 GIT_ 開頭的環境變數（compgen -e 逐一看名稱）：讀是為了擋，不是拿來改行為' },
  { file: 'scripts/selfcheck.mjs', name: '(間接:整包傳給函式)', reason: '入口拒絕 GIT_ 開頭的環境變數（把 process.env 傳給 gitEnvProblems 看名稱）：讀是為了擋，不是拿來改行為' },
  { file: 'scripts/pushgate-verify.sh', name: '(間接:compgen -e)', reason: '同上：驗法自己在入口拒絕同一類變數' },
  { file: 'scripts/pushgate-verify.sh', name: 'PATH', reason: '驗法把假 git 放在 PATH 最前面造失敗路徑（F10）；系統的環境變數，不是測試開關' },
  { file: 'scripts/pushgate-verify.sh', name: 'PUSHGATE_VERIFY_ORDER', reason: '驗法（不是正式閘門）的情境順序，只改先後、不改任何判準（M6：換順序跑結論要一樣）' },
];
/**
 * 讀環境變數的分支（2026-09-25 補充說明十一第 3 點：對照樣本要打到每一個分支）。每個分支配一個樣本；
 * envBranchSelfCheck 逐一拿掉每個分支，它的樣本就必須不再被列出來。
 * 直接讀（變數名在字面上）列出變數名；間接讀（變數名不在字面上）整類列成「(間接)」。
 */
export const ENV_BRANCHES = {
  shell: [
    { name: '$NAME', kind: 'direct', re: /\$([A-Z_][A-Z0-9_]*)/g, sample: 'git push "$' + 'KNOB_A" main' },
    { name: '${NAME', kind: 'direct', re: /\$\{([A-Z_][A-Z0-9_]*)/g, sample: 'x="${' + 'KNOB_B:-y}"' },
    { name: '自己讀自己', kind: 'selfref', sample: 'KNOB_E="${' + 'KNOB_E:-origin}"' },
    { name: '${!v}', kind: 'indirect', re: /\$\{!/, sample: 'for v in $list; do [ -n "${' + '!v+x}" ] && exit 6; done' },
    { name: 'printenv', kind: 'indirect', re: /\bprintenv\b/, sample: 'x="$(printenv "$name")"' },
    { name: 'compgen -e', kind: 'indirect', re: /\bcompgen\s+-e\b/, sample: 'for v in $(compgen -e); do echo "$v"; done' },
  ],
  js: [
    { name: 'process.env.NAME', kind: 'direct', re: /process\.env\.([A-Za-z_][A-Za-z0-9_]*)/g, sample: 'const a = process.env.' + 'KNOB_C;' },
    { name: "process.env['NAME']", kind: 'direct', re: /process\.env\[\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]\s*\]/g, sample: "const b = process.env['" + "KNOB_D'];" },
    { name: 'process.env[變數]', kind: 'indirect', re: /process\.env\[\s*[^'"\s]/, sample: 'const x = process.env[' + 'k];' },
    { name: 'Object.keys(process.env)', kind: 'indirect', re: /Object\.keys\(\s*process\.env\b/, sample: 'const ks = Object.keys(' + 'process.env);' },
    { name: 'Object.entries(process.env)', kind: 'indirect', re: /Object\.entries\(\s*process\.env\b/, sample: 'const es = Object.entries(' + 'process.env);' },
    { name: 'Object.values(process.env)', kind: 'indirect', re: /Object\.values\(\s*process\.env\b/, sample: 'const vs = Object.values(' + 'process.env);' },
    { name: '...process.env', kind: 'indirect', re: /\.\.\.process\.env\b/, sample: 'const e = { ...' + 'process.env };' },
    // 整包傳給函式（Object.keys／entries／values 那三種各有自己的分支，這裡排除，免得一個樣本被兩個分支抓到——分支自我檢查當場抓到過）
    { name: '整包傳給函式', kind: 'indirect', fn: (l) => /[(,]\s*process\.env\s*[,)]/.test(l) && !/Object\.(keys|entries|values)\(\s*process\.env/.test(l), sample: 'const bad = check(' + 'process.env);' },
  ],
};
export function envReads(text, isShell, skip = null) {
  const lines = text.split('\n').filter((l) => !isComment(l));
  const bs = (isShell ? ENV_BRANCHES.shell : ENV_BRANCHES.js).filter((b) => b.name !== skip);
  const reads = new Set();
  const out = new Set();
  if (isShell) {
    // 沒賦值過的＝從外面來的；賦值那一行自己讀自己（`X="${X:-預設}"`、`PATH="…:$PATH"`）也是從外面來的——
    // 只看「有沒有賦值」的話，這種形狀會躲過去（2026-09-25 寫這條時自己的對照組抓到）
    const selfRefOn = bs.some((b) => b.kind === 'selfref');
    const assigned = new Set(); const selfRef = new Set();
    for (const l of lines) {
      const r = bs.filter((b) => b.kind === 'direct').flatMap((b) => [...l.matchAll(b.re)].map((m) => m[1]));
      r.forEach((n) => reads.add(n));
      // 自己讀自己：不管上面哪一種直接讀法有沒有拿掉，都用完整的寫法判斷這一行是不是讀了自己
      const all = [...l.matchAll(/\$\{?([A-Z_][A-Z0-9_]*)/g)].map((m) => m[1]);
      for (const m of l.matchAll(/(?:^|[\s;(])(?:local\s+|export\s+)?([A-Z_][A-Z0-9_]*)=/g)) {
        assigned.add(m[1]);
        if (selfRefOn && all.includes(m[1])) { selfRef.add(m[1]); reads.add(m[1]); }
      }
    }
    for (const n of reads) if (!assigned.has(n) || selfRef.has(n)) out.add(n);
  } else {
    for (const l of lines) for (const b of bs.filter((x) => x.kind === 'direct')) for (const m of l.matchAll(b.re)) out.add(m[1]);
  }
  // 間接讀取按分支列（「(間接:分支名)」）：整類只列一個「(間接)」的話，一支檔登記過一次，以後再加哪一種間接讀法都不會被報出來（2026-09-25 G7-3 抓到）
  for (const b of bs.filter((x) => x.kind === 'indirect')) if (lines.some((l) => (b.fn ? b.fn(l) : b.re.test(l)))) out.add(`(間接:${b.name})`);
  return [...out].sort();
}
/** 讀環境變數的分支自我檢查：回 [{ branch, caught, soleCaught }] */
export function envBranchSelfCheck() {
  const res = [];
  for (const [kind, list] of Object.entries(ENV_BRANCHES)) for (const b of list) {
    const isShell = kind === 'shell';
    res.push({ branch: `${kind}｜${b.name}`, caught: envReads(b.sample, isShell).length > 0, soleCaught: envReads(b.sample, isShell, b.name).length === 0 });
  }
  return res;
}

export const FILE_RULES = [
  { id: 'format-no-meta', desc: '用 --format= 取新增行，卻沒有另外取 commit 訊息與作者欄（%B、%ae）',
    when: (text) => text.split('\n').some((l) => !isComment(l) && l.includes('--format=') && !l.includes('%B')),
    branches: [
      { name: '整支沒有 %B（沒取訊息）', fn: (text) => !text.includes('%B'),
        sample: 'git log -p --format= -U0 origin/main..HEAD > d.txt\ngit log --format=%ae origin/main..HEAD > a.txt' },
      { name: '有 %B、沒有 %ae（沒取作者欄）', fn: (text) => !text.includes('%ae'),
        sample: 'git log -p --format= -U0 origin/main..HEAD > d.txt\ngit log --format=%B origin/main..HEAD > m.txt' },
    ] },
];
for (const r of FILE_RULES) r.test = (text) => ruleHits(r, text);

/**
 * 登記的例外：初篩命中、逐條看過是合理的。每一條都要真的用到，否則算失敗。
 * { file, id, contains（那一行的特徵字串）, reason }
 */
export const EXCEPTIONS = [
  { file: 'scripts/pushgate.sh', id: 'absence', contains: 'if [ ! -f "$REG" ]; then',
    reason: '閘門的條件「沒有登記就擋下」：不存在時走的是擋下（回 4）那一邊，故障時停下，不是「斷言不存在就放行」' },
  { file: 'scripts/pushgate.sh', id: 'absence', contains: 'if [ ! -f "$BGREG" ]; then',
    reason: '第零關之二（F8 驗法登記）同一個形狀：沒有登記就擋下（回 5），不是「斷言不存在就放行」' },
  { file: 'scripts/pushgate-verify.sh', id: 'absence', contains: 'mustNot="$5"',
    reason: 'check() 的參數宣告；「不能有的字」之前同一個 check 先比對「必須有的字」——輸出檔不存在或是空的，must 就先不符' },
  { file: 'scripts/pushgate-verify.sh', id: 'absence', contains: 'grep -q -- "$mustNot" "$T/out"',
    reason: '同上：這一行之前先跑了 grep -q -- "$must"，輸出確實在、而且有預期的擋下理由，才看「不能有的字」' },
  { file: 'scripts/pushgate-verify.sh', id: 'plus3-header', contains: "grep -c '^+++ '",
    reason: '第 11 種的前置斷言，刻意數「以 +++ 開頭的行」（兩個檔頭＋那一行內容＝3），不是拿來判斷檔頭' },
  { file: 'scripts/pushgate.sh', id: 'format-no-meta', contains: '',
    reason: '第零關之二用 `git log --format= --name-only` 只取「這次要推的 commit 動到哪些檔」的檔名清單，不是取新增行；個資掃描由 selfcheck.mjs 負責（它另外取 %B、%ae）' },
  { file: 'scripts/pushgate-verify.sh', id: 'format-no-meta', contains: '',
    reason: '驗法用 --format= 只是數前置情境的行數，不是掃個資；掃描由 selfcheck.mjs 負責（它另外取 %B、%ae）' },
];

/**
 * 孤兒（v9 F4，2026-09-24）：登記制的配套——專案裡有推送指令（非註解行有 `git push`）、卻沒登記進 TARGETS 的腳本，一律報出來。
 * 不然新寫一支推送腳本，它不會被這裡掃到，也不會走閘門。掃 scripts/ 與專案根目錄（不遞迴）。
 */
export const ORPHAN_DIRS = ['scripts', '.'];
const SCRIPT_EXT = /\.(sh|bash|mjs|cjs|js|py|ps1)$/;
const PUSH_RX = /\bgit\s+push\b/;
/** 有推送指令、但不是推送腳本的：{ file, reason }。每一條都要真的用到。 */
export const ORPHAN_EXEMPT = [
  { file: 'scripts/gatescan.mjs', reason: '本檔：對照組樣本（當場組出來的壞寫法字串）裡有 git push，不是真的推送' },
  { file: 'scripts/doctest.mjs', reason: 'gatescan 的 G2 反例樣本字串裡有 git push，不是真的推送' },
];

/** 回 { orphans: [相對路徑], hits: 有推送指令的檔數, scanned: 掃了幾個檔, unreadable: [讀不到的目錄] } */
export function orphanScripts(root) {
  const orphans = []; const unreadable = [];
  let hits = 0, scanned = 0;
  for (const dir of ORPHAN_DIRS) {
    let names;
    try { names = fs.readdirSync(path.join(root, dir), { withFileTypes: true }); } catch { unreadable.push(dir); continue; }
    for (const d of names) {
      if (!d.isFile() || !SCRIPT_EXT.test(d.name)) continue;
      const rel = dir === '.' ? d.name : `${dir}/${d.name}`;
      scanned += 1;
      const text = fs.readFileSync(path.join(root, rel), 'utf8');
      if (!text.split('\n').some((l) => !isComment(l) && PUSH_RX.test(l))) continue;
      hits += 1;
      if (!TARGETS.includes(rel)) orphans.push(rel);
    }
  }
  return { orphans, hits, scanned, unreadable };
}

/**
 * 跳脫掃描（shell-regex）擴到 repo 裡所有腳本（2026-09-24 Dispatch 補充說明四）：以前只掃 TARGETS 那三支。
 * · 母體：整棵樹走一遍，副檔名是腳本的都算（加 package.json——npm scripts 就是 shell 指令列），不需要誰記得登記。
 *   不走 .git、node_modules、.logs（不是 repo 的內容）。TARGETS 那三支由上面的完整掃描負責，這裡不重複。
 * · 孤兒：拿 git 追蹤的檔案清單核對——被追蹤的腳本卻沒被走到（例如放在不走的目錄底下），一律報出來。
 *   取不到清單 → 停（檢查器壞了，不是 0 個孤兒）。
 * · 登記的例外（ESCAPE_EXEMPT）每一條都要真的用到。
 */
const WALK_SKIP = new Set(['.git', 'node_modules', '.logs']);
const isScriptFile = (name) => SCRIPT_EXT.test(name) || name === 'package.json';
export const ESCAPE_EXEMPT = [
  { file: 'scripts/mutationtest.mjs', contains: '會誤報 printf',
    reason: '突變的說明字串（講 gatescan 自己被誤報過的那一行），是資料不是指令' },
];
export function walkScripts(root) {
  const out = [];
  const walk = (rel) => {
    for (const d of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${d.name}` : d.name;
      if (d.isDirectory()) { if (!WALK_SKIP.has(d.name)) walk(r); }
      else if (d.isFile() && isScriptFile(d.name)) out.push(r);
    }
  };
  walk('');
  return out.sort();
}
export function gitTrackedScripts(root) {
  const txt = execFileSync('git', ['-c', 'core.quotepath=false', 'ls-files'], { cwd: root, encoding: 'utf8' });
  return txt.split('\n').filter(Boolean).filter((f) => isScriptFile(path.posix.basename(f)));
}
/** 回 { ok, scanned, lines, hits: [..], orphans: [..], unusedExempt: [..], error } */
export function escapeScan(root, listTracked = gitTrackedScripts) {
  let files;
  try { files = walkScripts(root); } catch (e) { return { ok: false, error: `走不完目錄：${e.message}` }; }
  let tracked;
  try { tracked = listTracked(root); } catch (e) { return { ok: false, error: `取不到 git 追蹤的檔案清單：${e.message}` }; }
  if (!files.length || !tracked.length) return { ok: false, error: `走到 ${files.length} 支、追蹤清單 ${tracked.length} 支——有一邊是空的` };
  const rule = LINE_RULES.find((r) => r.id === 'shell-regex');
  const used = new Set(); const hits = []; let lines = 0; let scanned = 0;
  for (const rel of files) {
    if (TARGETS.includes(rel)) continue;
    const text = fs.readFileSync(path.join(root, rel), 'utf8');
    scanned += 1; lines += text.split('\n').length;
    text.split('\n').forEach((l, i) => {
      if (isComment(l) || !rule.test(l)) return;
      const ex = ESCAPE_EXEMPT.findIndex((e) => e.file === rel && l.includes(e.contains));
      if (ex >= 0) { used.add(ex); return; }
      hits.push(`${rel}:${i + 1}｜${l.trim().slice(0, 120)}`);
    });
  }
  const walked = new Set(files);
  const orphans = tracked.filter((f) => !walked.has(f));
  const unusedExempt = ESCAPE_EXEMPT.filter((_, i) => !used.has(i)).map((e) => `${e.file}｜${e.contains}`);
  return { ok: !hits.length && !orphans.length && !unusedExempt.length, scanned, lines, hits, orphans, unusedExempt, error: null };
}

/** 掃一段文字：回 [{ id, line, text }]（逐行寫法）＋ 整支檔案的寫法。 */
export function scanText(text) {
  const hits = [];
  text.split('\n').forEach((l, i) => {
    if (isComment(l)) return;
    for (const r of LINE_RULES) if (r.test(l)) hits.push({ id: r.id, line: i + 1, text: l.trim() });
  });
  for (const r of FILE_RULES) if (r.test(text)) hits.push({ id: r.id, line: 0, text: '（整支檔案）' });
  return hits;
}

/**
 * 對照組：每一種寫法的樣本，當場組出來（不寫進任何被掃的檔）。
 * 「歷史」那幾條是本 App 真的寫過、推上去過的壞寫法原文（2026-09-23 以前）。
 */
export function controlSamples() {
  const out = {};
  for (const r of LINE_RULES) out[r.id] = r.branches.map((b) => b.sample);
  // 歷史：本 App 真的寫過、推上去過的壞寫法原文（2026-09-23 以前）
  out.pipe.push('node "$SP/selfcheck.mjs" ' + P + ' tail -5 && git push -q origin main');
  out['format-no-meta'] = [...FILE_RULES[0].branches.map((b) => b.sample),
    "const diff = execSync('git -c core.quotepath=off show HEAD --format= -U0', { encoding: 'utf8' });"]; // 歷史：只看 HEAD、不看訊息與作者欄
  return out;
}

export function main(root = ROOT, log = console.log, listTracked = gitTrackedScripts) {
  let ok = true;
  // 對照組先跑：每一種寫法都要抓得到
  const samples = controlSamples();
  for (const r of [...LINE_RULES, ...FILE_RULES]) {
    const list = samples[r.id] ?? [];
    const caught = list.filter((s) => scanText(s).some((h) => h.id === r.id)).length;
    const good = list.length > 0 && caught === list.length;
    log(`對照組｜${r.id}｜${caught}/${list.length} 抓到${good ? '' : '｜檢查器壞了：這一種的樣式抓不到已知的壞寫法'}`);
    if (!good) ok = false;
  }
  // 分支的自我檢查：每個分支的樣本，拿掉那個分支就要抓不到（對照樣本要打到每一個分支，不是只打到其中一支）
  for (const r of [...LINE_RULES, ...FILE_RULES]) {
    const bs = branchSelfCheck().filter((x) => x.rule === r.id);
    const bad = bs.filter((x) => !x.caught || !x.soleCaught);
    log(`分支｜${r.id}｜${bs.length - bad.length}/${bs.length} 各有只靠它的樣本${bad.length ? `｜檢查器壞了：${bad.map((x) => `${x.branch}${x.caught ? '（樣本被別的分支順便抓到）' : '（樣本抓不到）'}`).join('、')}` : ''}`);
    if (bad.length) ok = false;
  }
  // 掃登記的檔
  const used = new Set();
  let lines = 0;
  for (const rel of TARGETS) {
    const p = path.join(root, rel);
    const text = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
    if (!text || !text.trim()) { log(`讀不到或是空的：${rel}（檢查器壞了，不是 0 個問題）`); ok = false; continue; }
    lines += text.split('\n').length;
    for (const h of scanText(text)) {
      const ex = EXCEPTIONS.findIndex((e) => e.file === rel && e.id === h.id && (h.line === 0 || h.text.includes(e.contains)));
      if (ex >= 0) { used.add(ex); log(`登記的例外｜${rel}:${h.line}｜${h.id}｜${EXCEPTIONS[ex].reason}`); continue; }
      log(`命中｜${rel}:${h.line}｜${h.id}｜${h.text.slice(0, 120)}`);
      ok = false;
    }
  }
  EXCEPTIONS.forEach((e, i) => { if (!used.has(i)) { log(`登記的例外沒用到（那一行改掉了？拿掉這條例外）｜${e.file}｜${e.id}｜${e.contains}`); ok = false; } });
  // 讀環境變數：對照組先跑（兩個方向），再掃 TARGETS
  const envCtl = [
    envReads('REMOTE="${' + 'PUSHGATE_REMOTE:-origin}"\ngit push "$REMOTE" main', true).join(',') === 'PUSHGATE_REMOTE',
    envReads("const brk = process.env." + "PREPUSH_SELFTEST_BREAK;\nconst u = process.env['" + "X_TEST'];", false).join(',') === 'PREPUSH_SELFTEST_BREAK,X_TEST',
    envReads('LOG=".logs/x"\nlocal N=1\necho "$LOG $N"', true).length === 0,
    envReads('# 註解裡的 $' + 'SECRET_KNOB 不算', true).length === 0,
    envReads('PUSHGATE_REMOTE="${' + 'PUSHGATE_REMOTE:-origin}"\ngit push "$' + 'PUSHGATE_REMOTE" main', true).join(',') === 'PUSHGATE_REMOTE',
    envReads('for v in $list; do [ -n "${' + '!v+x}" ] && exit 6; done', true).join(',') === '(間接:${!v})',
    envReads('const k = pick();\nconst x = process.env[' + 'k];', false).join(',') === '(間接:process.env[變數])',
  ];
  const envCtlOk = envCtl.every(Boolean);
  const envBs = envBranchSelfCheck(); const envBad = envBs.filter((x) => !x.caught || !x.soleCaught);
  log(`分支｜env-read｜${envBs.length - envBad.length}/${envBs.length} 各有只靠它的樣本${envBad.length ? `｜檢查器壞了：${envBad.map((x) => x.branch).join('、')}` : ''}`);
  if (envBad.length) ok = false;
  log(`對照組｜env-read｜${envCtl.filter(Boolean).length}/${envCtl.length} 對${envCtlOk ? '' : '｜檢查器壞了：讀環境變數的判準抓不到已知的樣本、或誤報了賦值與註解'}`);
  if (!envCtlOk) ok = false;
  const envUsed = new Set();
  for (const rel of TARGETS) {
    const p = path.join(root, rel);
    if (!fs.existsSync(p)) continue; // 讀不到的，上面已經判過不通過
    for (const name of envReads(fs.readFileSync(p, 'utf8'), rel.endsWith('.sh'))) {
      const i = ENV_ALLOW.findIndex((e) => e.file === rel && e.name === name);
      if (i >= 0) { envUsed.add(i); continue; }
      log(`讀環境變數｜${rel}｜${name}｜沒登記：正式閘門不讀測試用的環境變數；真的需要就登記進 ENV_ALLOW 並寫理由`);
      ok = false;
    }
  }
  ENV_ALLOW.forEach((e, i) => { if (!envUsed.has(i) && fs.existsSync(path.join(root, e.file))) { log(`讀環境變數的登記沒用到（那一行改掉了？拿掉這條登記）｜${e.file}｜${e.name}`); ok = false; } });
  // 孤兒：有推送指令、卻沒登記進 TARGETS 的腳本
  const orph = orphanScripts(root);
  if (orph.unreadable.length) { log(`孤兒檢查讀不到目錄：${orph.unreadable.join('、')}（檢查器壞了，不是 0 個問題）`); ok = false; }
  const usedEx = new Set();
  for (const rel of orph.orphans) {
    const ex = ORPHAN_EXEMPT.findIndex((e) => e.file === rel);
    if (ex >= 0) { usedEx.add(ex); log(`孤兒的登記例外｜${rel}｜${ORPHAN_EXEMPT[ex].reason}`); continue; }
    log(`孤兒｜${rel}｜有推送指令（git push），卻沒登記進 TARGETS：要走閘門就登記進來，不是推送腳本就列進 ORPHAN_EXEMPT 並寫理由`);
    ok = false;
  }
  ORPHAN_EXEMPT.forEach((e, i) => { if (!usedEx.has(i)) { log(`孤兒的登記例外沒用到（那支檔改掉了？拿掉這條例外）｜${e.file}`); ok = false; } });
  log(`孤兒檢查：掃了 ${orph.scanned} 支腳本，其中 ${orph.hits} 支有推送指令`);
  // 跳脫掃描：repo 裡所有腳本
  const es = escapeScan(root, listTracked);
  if (es.error) { log(`跳脫掃描壞了：${es.error}（檢查器壞了，不是 0 個問題）`); ok = false; }
  else {
    for (const h of es.hits) log(`跳脫｜${h}｜grep／sed 的樣式含反斜線、寫在 shell 指令列上`);
    for (const f of es.orphans) log(`跳脫掃描的孤兒｜${f}｜git 有追蹤、目錄走訪卻沒走到`);
    for (const u of es.unusedExempt) log(`跳脫掃描的登記例外沒用到｜${u}`);
    if (!es.ok) ok = false;
    log(`跳脫掃描：走了 ${es.scanned} 支腳本（不含上面三支）、${es.lines} 行；登記的例外 ${ESCAPE_EXEMPT.length} 條`);
  }
  log(`查了：${TARGETS.length} 支檔案、${lines} 行；寫法 ${LINE_RULES.length + FILE_RULES.length} 種；登記的例外 ${EXCEPTIONS.length} 條`);
  log(ok ? 'gatescan 通過' : 'gatescan 不通過');
  return ok;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!main()) process.exitCode = 1;
}

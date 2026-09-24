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

/** 逐行的寫法：{ id, 說明, test(一行) } */
export const LINE_RULES = [
  { id: 'pipe', desc: '自查、推送、取遠端狀態、取 diff 的那一行後面接管線',
    test: (l) => /(selfcheck|\bgit\s+(push|ls-remote|fetch|log|diff|show)\b)/.test(l) && hasPipe(l) },
  { id: 'or-true', desc: '`|| true`（失敗照樣往下走）', test: (l) => /\|\|\s*true\b/.test(l) },
  { id: 'empty-catch', desc: '空的 catch', test: (l) => /catch\s*(\([^)]*\))?\s*\{\s*\}/.test(l) },
  { id: 'plus3-header', desc: '用「以 +++ 開頭」判斷 diff 檔頭',
    test: (l) => /startsWith\(\s*['"]\+\+\+/.test(l) || /['"]\^\+\+\+/.test(l) },
  { id: 'absence', desc: '斷言「不存在」（初篩：要先確認它原本在）',
    test: (l) => /!\s*fs\.existsSync\(|\[\s*!\s+-[fe]\s|不見了|還在嗎|mustNot/.test(l) },
  { id: 'shell-regex', desc: 'grep／sed 的樣式含反斜線、寫在 shell 指令列上（初篩：同一次執行裡要跑過對照組）',
    // 只看 grep／sed 後面那個引號裡的樣式（2026-09-24：原本整行有反斜線就算，`printf "%s\n" … | grep -qE "^[1-9]"` 被誤報）
    test: (l) => [...l.matchAll(/\b(grep|sed)\b[^|;]*?(['"])((?:(?!\2).)*)\2/g)].some((m) => m[3].includes('\\')) },
];

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
  { file: 'scripts/pushgate.sh', name: '(間接)', reason: '入口拒絕 git 自己認得的環境變數（GIT_DIR 之類）：逐一 ${!v+x} 讀，是為了擋，不是拿來改行為' },
  { file: 'scripts/pushgate-verify.sh', name: '(間接)', reason: '同上：驗法自己在入口拒絕同一類變數' },
  { file: 'scripts/pushgate-verify.sh', name: 'PATH', reason: '驗法把假 git 放在 PATH 最前面造失敗路徑（F10）；系統的環境變數，不是測試開關' },
  { file: 'scripts/pushgate-verify.sh', name: 'PUSHGATE_VERIFY_ORDER', reason: '驗法（不是正式閘門）的情境順序，只改先後、不改任何判準（M6：換順序跑結論要一樣）' },
];
export function envReads(text, isShell) {
  const lines = text.split('\n').filter((l) => !isComment(l));
  const reads = new Set();
  if (isShell) {
    // 沒賦值過的＝從外面來的；賦值那一行自己讀自己（`X="${X:-預設}"`、`PATH="…:$PATH"`）也是從外面來的——
    // 只看「有沒有賦值」的話，這種形狀會躲過去（2026-09-25 寫這條時自己的對照組抓到）
    const assigned = new Set(); const selfRef = new Set();
    for (const l of lines) {
      const r = [...l.matchAll(/\$\{?([A-Z_][A-Z0-9_]*)/g)].map((m) => m[1]);
      r.forEach((n) => reads.add(n));
      for (const m of l.matchAll(/(?:^|[\s;(])(?:local\s+|export\s+)?([A-Z_][A-Z0-9_]*)=/g)) {
        assigned.add(m[1]);
        if (r.includes(m[1])) selfRef.add(m[1]);
      }
    }
    // 間接讀取（`${!v}`、`printenv`）：變數名不在字面上，上面那條抓不到——整類列成「(間接)」，要用就得登記理由（2026-09-25）
    const out = [...reads].filter((n) => !assigned.has(n) || selfRef.has(n));
    if (lines.some((l) => /\$\{!/.test(l) || /\bprintenv\b/.test(l))) out.push('(間接)');
    return out.sort();
  }
  for (const l of lines) for (const m of l.matchAll(/process\.env(?:\.([A-Za-z_][A-Za-z0-9_]*)|\[\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]\s*\])/g)) reads.add(m[1] ?? m[2]);
  // JS 的間接讀取：鍵不是字面、或整包拿（Object.keys／entries／values、展開）
  if (lines.some((l) => /process\.env\[\s*[^'"\s]/.test(l) || /Object\.(keys|entries|values)\(\s*process\.env\b/.test(l) || /\.\.\.process\.env\b/.test(l))) reads.add('(間接)');
  return [...reads].sort();
}

export const FILE_RULES = [
  { id: 'format-no-meta', desc: '用 --format= 取新增行，卻沒有另外取 commit 訊息與作者欄（%B、%ae）',
    test: (text) => text.split('\n').some((l) => !isComment(l) && l.includes('--format=') && !l.includes('%B'))
      && !(text.includes('%B') && text.includes('%ae')) },
];

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
  { file: 'scripts/mutationtest.mjs', contains: 'replace: "    test: (l) => /',
    reason: 'gatescan 自己的突變：把 shell-regex 判準改回舊寫法的替換字串，是資料不是指令' },
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
  const P = '|';
  return {
    pipe: [
      'node scripts/selfcheck.mjs ' + P + ' tail -1 && git push -q origin main',              // 合成
      'node "$SP/selfcheck.mjs" ' + P + ' tail -5 && git push -q origin main',               // 歷史：2026-09-23 的推送行（自查回傳值被吞掉）
      'REMOTE_SHA="$(git ls-remote "$REMOTE" refs/heads/main 2>"$LOG" ' + P + ' cut -f1)"', // 歷史：v7 第三關的初稿
    ],
    'or-true': ['git push -q origin main ' + P + P + ' true'],
    'empty-catch': ['try { run(); } catch ' + '{}', 'try { run(); } catch (e) ' + '{ }'],
    'plus3-header': [
      "const added = diff.split('\\n').filter(l => l.startsWith('+') && !l.startsWith('" + '+++' + "'));", // 歷史：2026-09-23 以前的自查
      "grep -v '^" + '+++' + "' diff.txt",
    ],
    absence: ["ok(!fs.existsSync(" + "reg), '登記刪掉了')", 'if [ ! -f "$REG" ]; then', "console.log('登記檔還在嗎：' + regLeft)"],
    'shell-regex': ["grep -E '^" + '\\' + "s+foo' out.txt", "sed -i 's/" + '\\' + "bx/y/' f"],
    'format-no-meta': ["const diff = execSync('git -c core.quotepath=off show HEAD --format= -U0', { encoding: 'utf8' });"], // 歷史：2026-09-23 以前的自查（只看 HEAD、不看訊息與作者欄）
  };
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
    envReads('for v in $list; do [ -n "${' + '!v+x}" ] && exit 6; done', true).join(',') === '(間接)',
    envReads('const k = pick();\nconst x = process.env[' + 'k];', false).join(',') === '(間接)',
  ];
  const envCtlOk = envCtl.every(Boolean);
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

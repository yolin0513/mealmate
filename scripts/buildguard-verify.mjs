// build-recipes、build-foods 的驗法（v9 F8，2026-09-24）：資料不見、壞掉、變少時，要停下、點名是哪一個單位、一個檔都不寫。
// 用法：node --max-old-space-size=4096 scripts/buildguard-verify.mjs --rev <commit> [--only recipes|foods]
//       node scripts/buildguard-verify.mjs --compare <舊版的 log> <新版的 log>   （比對兩份結果前，先斷言兩邊抽到的母體一樣多）
//   在 repo 外的拋棄式 worktree（那個 commit）裡跑。原始資料用「複本」（主 repo 的 data/raw/ 不碰）。
//
// 母體是「每一個單位 × 每一種情境」，寫成迴圈、不挑代表：
//   build-recipes：每一道食譜檔 ×（刪掉、內容清空、欄位名稱打錯）＋ 整體（資料夾清空、資料夾不存在、foods.json 不存在、暫存檔的位置被資料夾佔住）
//   build-foods：必要欄位 × 改名、營養素 × 那一項的列全部拿掉、分類 × 那一類的列全部拿掉 ＋ 整體（資料夾不存在、空陣列、JSON 壞掉、只給前 5%、暫存檔的位置被資料夾佔住）
// 每一格四件事都要成立才算「擋」：回傳值非 0；**錯誤訊息的位置**（stderr 裡「✗」那一行起）點名這個單位；
// 輸出檔雜湊前後相同、沒有留下暫存檔；沒有吐出未處理例外的堆疊。
// 「點名」只在錯誤訊息的位置比對，不看整份輸出（2026-09-24 補充說明四）：正常輸出本來就會印出檔名、食譜 id——
// 在整份輸出裡找，「出現過」會被當成「是理由」。id 還要對邊界：r-foo 不能被 r-foo-veg 湊到。
// 回傳非 0 但理由沒點名這個單位的——被別的規則碰巧擋下——一律算「沒擋」。
// 全部都擋、基準（什麼都不改）放行、母體數量對、對照組兩個方向都對，才回 0。
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

/** 錯誤訊息的位置：stderr 裡第一個以「✗」開頭的那一行起到最後。沒有「✗」→ 空字串（沒有設計好的理由）。 */
export function reasonOf(stderr) {
  const lines = String(stderr ?? '').split(/\r?\n/);
  const i = lines.findIndex((l) => l.startsWith('✗'));
  return i < 0 ? '' : lines.slice(i).join('\n');
}
/** 錯誤訊息的位置有沒有點名這個單位：前後不能緊接英數字或連字號（r-foo 不算被 r-foo-veg 點名）。 */
export function names(stderr, token) {
  const reason = reasonOf(stderr);
  const edge = /[A-Za-z0-9_-]/;
  for (let i = reason.indexOf(token); i >= 0; i = reason.indexOf(token, i + 1)) {
    const before = reason[i - 1] ?? ''; const after = reason[i + token.length] ?? '';
    if (!(before && edge.test(before) && edge.test(token[0])) && !(after && edge.test(after) && edge.test(token[token.length - 1]))) return true;
  }
  return false;
}
/** 吐出未處理例外的堆疊（設計好的理由沒印出來）。 */
export const hasStack = (stderr) => /^\s+at .+(:\d+:\d+\)?|\(node:[^)]*\))$/m.test(String(stderr ?? ''));

/** 對照組（兩個方向）：判準本身先驗，不對就不往下跑。回 [{ ok, label }] */
export function selfControls() {
  const cases = [
    // 應判「算」
    [true, '只出現在錯誤訊息的位置', '讀 data/raw …\n✗ 沒有寫檔：\n  - 少了 r-foo（某道菜）：上一版有、這次沒有', 'r-foo'],
    [true, '食譜驗證的錯誤段（檔名那一行）', '✗ 2 道食譜有問題，沒有寫檔：\n  r-foo.json\n    - 步驟至少 3 步', 'r-foo'],
    [true, '類別名稱在「」裡', '✗ 沒有寫檔：\n  - 類別「乳品類」整個不見了（上一版 80 種）', '「乳品類」'],
    // 應判「不算」
    [false, '只出現在錯誤訊息之前的正常進度訊息', '處理 r-foo.json …\n✗ 沒有寫檔：\n  - 一道食譜都沒有（0 道）', 'r-foo'],
    [false, '只出現在未處理例外裡——沒有「✗」就沒有設計好的理由', 'Error: ENOENT r-foo.json\n    at x (file.mjs:1:1)', 'r-foo'],
    [false, '前綴相同的另一道（r-foo 不能被 r-foo-veg 湊到）', '✗ 沒有寫檔：\n  - 少了 r-foo-veg（素版）', 'r-foo'],
    [false, '後綴相同的另一道', '✗ 沒有寫檔：\n  - 少了 xr-foo（別的）', 'r-foo'],
  ];
  const out = cases.map(([want, label, err, tok]) => ({ ok: names(err, tok) === want, label: `點名判準｜${want ? '應算' : '不算'}｜${label}` }));
  out.push({ ok: hasStack('Error: x\n    at Object.<anonymous> (/a/b.mjs:3:9)\n    at node:internal/x:1:1'), label: '堆疊判準｜應算｜有 at 行' });
  out.push({ ok: !hasStack('✗ 沒有寫檔：\n  - 寫 data/recipes.json 失敗：EISDIR'), label: '堆疊判準｜不算｜設計好的理由' });
  // 比對模式的擷取（§5.11 第二層）：抓空的話，「兩邊母體一樣多」就退化成沒比
  const g = groupsOf('版本 x\nbuild-recipes｜刪掉那一道｜248 格｜擋 0｜沒擋 248（其中…）\n    沒擋：r-a.json｜回傳 0\nbuild-foods｜整體｜5 格｜擋 5｜沒擋 0（其中…）\n');
  out.push({ ok: Object.keys(g).length === 2 && g['build-recipes｜刪掉那一道']?.n === 248 && g['build-foods｜整體']?.not === 0, label: '比對模式的擷取｜應抽到｜兩組、格數與沒擋數' });
  out.push({ ok: versionOf('對照組｜對｜x\n版本 217db3f｜build-recipes sha=…') === '217db3f' && versionOf('沒有版本行') === null, label: '比對模式的版本擷取｜應抽到｜抽不到回 null' });
  return out;
}

/**
 * 登記制（2026-09-24，Yolin 同意、Dispatch 交辦；推送閘門第零關之二比對，對不上回 5）：
 * 全擋時把這三支的雜湊登記進 `.logs/buildguard-verified.txt`（本機、不進版控）。
 * 登記的必須是 HEAD：對任意 --rev 跑出來的結果不能登記（那證明的是別的版本）；只跑一部分（--only）也不能。
 */
export const BG_FILES = ['scripts/build-recipes.mjs', 'scripts/build-foods.mjs', 'scripts/buildguard-verify.mjs'];
export const BG_REG = '.logs/buildguard-verified.txt';
/** 回 { action: 'register'|'delete'|'keep', why } */
export function registrationDecision({ only, fail, isHead, headMoved, dirty }) {
  if (only) return { action: 'keep', why: '只跑了一部分（--only），不登記、不動現有的登記' };
  if (!isHead) return { action: 'keep', why: '--rev 不是 HEAD：證明的是別的版本，不登記、不動現有的登記' };
  if (fail) return { action: 'delete', why: 'HEAD 沒有全擋：刪掉登記，閘門會擋下推送' };
  if (headMoved) return { action: 'delete', why: '跑的途中 HEAD 動了：跑的不是現在的 HEAD，不登記、刪掉舊登記' };
  if (dirty.length) return { action: 'delete', why: `工作區的 ${dirty.join('、')} 跟 HEAD 不一樣（跑的驗法不是 HEAD 那一份——HEAD 那一版沒被驗過），不登記、刪掉舊登記——先 commit 再跑` };
  return { action: 'register', why: 'HEAD 全擋：登記三支檔案已 commit 版本的雜湊' };
}

/** 工作區跟 HEAD 不一樣的被守檔（兩個不同的來源：工作區的檔 vs HEAD 裡的 blob）。 */
export function dirtyGuarded(repo) {
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8' }).trim();
  return BG_FILES.filter((f) => git('hash-object', f) !== git('rev-parse', `HEAD:${f}`));
}
/**
 * 跑完之後的登記（F9）：判斷、寫或刪 `.logs/buildguard-verified.txt`。回 { action, why }。
 * 登記的是 headAtStart 裡「已 commit 版本」的雜湊；讀不到雜湊就刪掉登記（故障時停下，不是放行）。
 */
export function finalizeRegistration(repo, { only, fail, revFull, headAtStart }) {
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8' }).trim();
  const regPath = path.join(repo, BG_REG);
  let d;
  try {
    d = registrationDecision({ only, fail, isHead: revFull === headAtStart, headMoved: git('rev-parse', 'HEAD') !== headAtStart, dirty: dirtyGuarded(repo) });
  } catch (e) { d = { action: 'delete', why: `讀不到雜湊（${e.message.split('\n')[0]}），刪掉登記` }; }
  if (d.action === 'register') {
    fs.mkdirSync(path.dirname(regPath), { recursive: true });
    fs.writeFileSync(regPath, BG_FILES.map((f) => `${f} ${git('rev-parse', `${headAtStart}:${f}`)}\n`).join(''));
  } else if (d.action === 'delete') fs.rmSync(regPath, { force: true });
  return d;
}

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 12);
const isFile = (p) => fs.existsSync(p) && fs.statSync(p).isFile();
const fileSha = (p) => (isFile(p) ? sha(fs.readFileSync(p)) : fs.existsSync(p) ? '（是資料夾）' : '（不存在）');

/** 解析一份 log 的每一組：{ group: 格數 }，外加總數 */
export function groupsOf(log) {
  const g = {};
  for (const m of String(log).matchAll(/^(build-(?:recipes|foods)｜[^｜\n]+)｜(\d+) 格｜擋 (\d+)｜沒擋 (\d+)/gm)) g[m[1]] = { n: Number(m[2]), blocked: Number(m[3]), not: Number(m[4]) };
  return g;
}

/** log 第一行「版本 xxx｜…」的版本；抽不到回 null。 */
export const versionOf = (log) => (/^版本 (\S+?)｜/m.exec(String(log)) ?? [])[1] ?? null;
export function compare(aPath, bPath) {
  const la = fs.readFileSync(aPath, 'utf8'), lb = fs.readFileSync(bPath, 'utf8');
  // 「兩邊母體一樣」的前提：兩份是不同版本跑出來的——同一份 log 比兩次、或兩次都跑同一個版本，永遠「相同」
  const va = versionOf(la), vb = versionOf(lb);
  if (!va || !vb || va === vb) { console.log(`兩份 log 不是兩個不同的版本（舊 ${va ?? '抽不到'}、新 ${vb ?? '抽不到'}）：拿自己跟自己比，不算比對`); return 1; }
  const A = groupsOf(la); const B = groupsOf(lb);
  const keys = [...new Set([...Object.keys(A), ...Object.keys(B)])];
  let bad = 0;
  if (!keys.length) { console.log('兩份 log 都抽不到任何一組（擷取壞了，不是「沒有差異」）'); return 1; }
  for (const k of keys) {
    const a = A[k], b = B[k];
    const same = a && b && a.n === b.n && a.n > 0;
    if (!same) bad += 1;
    console.log(`${same ? '母體相同' : '母體不符'}｜${k}｜舊 ${a ? `${a.n} 格、沒擋 ${a.not}` : '（沒有這一組）'}｜新 ${b ? `${b.n} 格、沒擋 ${b.not}` : '（沒有這一組）'}`);
  }
  const sum = (G) => Object.values(G).reduce((s, x) => s + x.n, 0);
  console.log(`總數｜舊 ${sum(A)} 格（沒擋 ${Object.values(A).reduce((s, x) => s + x.not, 0)}）｜新 ${sum(B)} 格（沒擋 ${Object.values(B).reduce((s, x) => s + x.not, 0)}）`);
  return bad ? 1 : 0;
}

function verify(rev, only) {
  const repo = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  const RAW_NAME = 'tfnd-2026-08-26.json';
  const RAW_MAIN = path.join(repo, 'data/raw', RAW_NAME);
  let fail = 0;
  // 對照組先跑
  for (const c of selfControls()) { console.log(`對照組｜${c.ok ? '對' : '錯'}｜${c.label}`); if (!c.ok) fail += 1; }
  if (fail) { console.log('buildguard 驗法：對照組不對，判準壞了，不往下跑'); return 1; }

  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8' }).trim();
  const headAtStart = git('rev-parse', 'HEAD');
  const revFull = git('rev-parse', `${rev}^{commit}`);
  // F9 第 1 點：登記前先斷言工作區那三支跟 HEAD 一模一樣。開跑前先講，不要跑完 7 分鐘才發現登記不了（跑完登記前還會再查一次）
  const dirtyNow = () => dirtyGuarded(repo);
  if (revFull === headAtStart && !only && dirtyNow().length) console.log(`登記｜先講｜工作區的 ${dirtyNow().join('、')} 跟 HEAD 不一樣：這一輪會跑，但跑完不會登記（先 commit 再跑）`);
  const wt = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-bg-'));
  fs.rmSync(wt, { recursive: true });
  execFileSync('git', ['-C', repo, 'worktree', 'add', '-q', '--detach', wt, rev]);
  try {
    const head = execFileSync('git', ['-C', wt, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
    const br = fs.readFileSync(path.join(wt, 'scripts/build-recipes.mjs'), 'utf8');
    const bf = fs.readFileSync(path.join(wt, 'scripts/build-foods.mjs'), 'utf8');
    console.log(`版本 ${head}｜build-recipes sha=${sha(br)}（outputProblems：${br.includes('export function outputProblems') ? '有' : '沒有'}；writeAtomically：${br.includes('export function writeAtomically') ? '有' : '沒有'}）｜build-foods sha=${sha(bf)}（rawProblems／foodsProblems：${bf.includes('export function rawProblems') && bf.includes('export function foodsProblems') ? '有' : '沒有'}）`);
    const restore = () => {
      for (const p of ['data/recipes.json.tmp', 'data/foods.json.tmp']) fs.rmSync(path.join(wt, p), { recursive: true, force: true });
      execFileSync('git', ['-C', wt, 'checkout', '-q', '--', 'data']);
      execFileSync('git', ['-C', wt, 'clean', '-q', '-fd', '--', 'data/recipes']);
    };
    // 跑一格：setup → 記輸出檔雜湊 → 跑 → 判四件事；post（選填）是這一格額外要成立的條件
    const cell = (script, outRel, setup, token, post = null) => {
      restore();
      setup();
      const out = path.join(wt, outRel); const tmp = `${out}.tmp`;
      const tmpBefore = fs.existsSync(tmp);
      const before = fileSha(out);
      const r = spawnSync(process.execPath, ['--max-old-space-size=4096', `scripts/${script}`], { cwd: wt, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
      const err = r.stderr ?? '';
      const named = token === null || names(err, token);
      const same = fileSha(out) === before;
      const tmpLeft = !tmpBefore && fs.existsSync(tmp);
      const stack = hasStack(err);
      const postOk = post ? post({ out, tmp }) : true;
      const blocked = r.status !== 0 && named && same && !tmpLeft && !stack && postOk;
      return { blocked, code: r.status, named, same, tmpLeft, stack, postOk, err };
    };
    const report = (group, results, expectN) => {
      const bad = results.filter((x) => !x.blocked);
      const coincid = bad.filter((x) => x.code !== 0 && !x.named).length;
      const nOk = results.length === expectN && expectN > 0;
      console.log(`${group}｜${results.length} 格｜擋 ${results.length - bad.length}｜沒擋 ${bad.length}（其中回非 0 但錯誤訊息沒點名這個單位＝被別的規則碰巧擋下 ${coincid}）${nOk ? '' : `｜母體數量不符：預期 ${expectN}`}`);
      for (const x of bad.slice(0, 5)) {
        const first = (reasonOf(x.err).split('\n')[0] || (x.err.split('\n').find((l) => l.trim()) ?? '')).trim().slice(0, 90);
        console.log(`    沒擋：${x.unit}｜回傳 ${x.code}｜點名 ${x.named}｜輸出檔沒動 ${x.same}｜留下暫存檔 ${x.tmpLeft}｜堆疊 ${x.stack}｜額外條件 ${x.postOk}｜${first}`);
      }
      if (bad.length || !nOk) fail += 1;
    };
    // 暫存檔的位置先放一個同名資料夾（裡面有一個檔）：真的寫不進去；那個資料夾不是 build 寫的，要原封不動
    const occupyTmp = (outRel) => () => { const d = path.join(wt, `${outRel}.tmp`); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'keep.txt'), 'x'); };
    const tmpDirIntact = ({ tmp }) => fs.existsSync(tmp) && fs.statSync(tmp).isDirectory() && isFile(path.join(tmp, 'keep.txt'));

    // 「輸出檔沒動」這一項判準自己的對照組（Dispatch 2026-09-24，F10）：以前能偵測到「有動」的證據，只有舊版跑出來的那幾格（一次性）。
    // 合成兩支假的 build（跟版本無關）：都印出設計好的理由、點名 r-sentinel、回 1；一支失敗時仍寫出一個位元組 → 那一格必須判「沒擋」，
    // 而且要是「輸出檔沒動」這一項抓到的（其他三項都成立）；另一支不寫 → 判「擋」。任一方向不對就不往下跑。
    const sentinelSrc = (writeByte) => "import fs from 'node:fs';\nconsole.error('✗ 沒有寫檔：');\nconsole.error('  - 少了 r-sentinel（合成的對照組）');\n"
      + (writeByte ? "fs.appendFileSync('data/recipes.json', 'x');\n" : '') + 'process.exit(1);\n';
    const sentinels = { write: 'scripts/_sentinel-write.mjs', clean: 'scripts/_sentinel-clean.mjs' };
    fs.writeFileSync(path.join(wt, sentinels.write), sentinelSrc(true));
    fs.writeFileSync(path.join(wt, sentinels.clean), sentinelSrc(false));
    const sw = cell('_sentinel-write.mjs', 'data/recipes.json', () => {}, 'r-sentinel');
    const sc = cell('_sentinel-clean.mjs', 'data/recipes.json', () => {}, 'r-sentinel');
    for (const p of Object.values(sentinels)) fs.rmSync(path.join(wt, p), { force: true });
    restore();
    const swOk = !sw.blocked && !sw.same && sw.code === 1 && sw.named && !sw.stack && !sw.tmpLeft;
    const scOk = sc.blocked;
    console.log(`對照組｜${swOk ? '對' : '錯'}｜輸出檔沒動｜失敗時仍寫出一個位元組 → 判沒擋、而且是這一項抓到的（回傳 ${sw.code}、點名 ${sw.named}、輸出檔沒動 ${sw.same}）`);
    console.log(`對照組｜${scOk ? '對' : '錯'}｜輸出檔沒動｜失敗時不寫 → 判擋（回傳 ${sc.code}、點名 ${sc.named}、輸出檔沒動 ${sc.same}）`);
    if (!swOk || !scOk) {
      console.log('buildguard 驗法：「輸出檔沒動」的對照組不對，判準壞了，不往下跑');
      const d0 = finalizeRegistration(repo, { only, fail: 1, revFull, headAtStart });
      console.log(`登記｜${d0.action === 'delete' ? '已刪掉' : '沒動'}｜${d0.why}`);
      return 1;
    }

    if (!only || only === 'recipes') {
      const B = 'build-recipes.mjs', OUT = 'data/recipes.json';
      const base = cell(B, OUT, () => {}, null);
      const baseOk = base.code === 0;
      console.log(`build-recipes｜基準（什麼都不改）｜回傳 ${base.code}｜${baseOk ? '放行' : '沒放行——基準不綠，下面的結果不採信'}`);
      if (!baseOk) fail += 1;
      restore();
      const files = fs.readdirSync(path.join(wt, 'data/recipes')).filter((f) => f.endsWith('.json')).sort();
      const expectFiles = JSON.parse(fs.readFileSync(path.join(wt, OUT), 'utf8')).recipes.length;
      console.log(`build-recipes｜母體｜食譜檔 ${files.length} 支（recipes.json 裡 ${expectFiles} 道）`);
      if (files.length !== expectFiles || !files.length) { console.log('    母體數量不符：食譜檔的數量跟 recipes.json 對不起來'); fail += 1; }
      const p = (f) => path.join(wt, 'data/recipes', f);
      const scen = {
        '刪掉那一道': (f) => fs.rmSync(p(f)),
        '內容清空': (f) => fs.writeFileSync(p(f), ''),
        '欄位名稱打錯（ingredients → ingredient）': (f) => { const j = JSON.parse(fs.readFileSync(p(f), 'utf8')); j.ingredient = j.ingredients; delete j.ingredients; fs.writeFileSync(p(f), JSON.stringify(j)); },
      };
      for (const [name, fn] of Object.entries(scen)) {
        report(`build-recipes｜${name}`, files.map((f) => ({ unit: f, ...cell(B, OUT, () => fn(f), f.replace(/\.json$/, '')) })), expectFiles);
      }
      report('build-recipes｜整體', [
        { unit: '資料夾清空', ...cell(B, OUT, () => { for (const f of files) fs.rmSync(p(f)); }, '0 道') },
        { unit: '資料夾不存在', ...cell(B, OUT, () => fs.rmSync(path.join(wt, 'data/recipes'), { recursive: true }), 'data/recipes 不存在') },
        { unit: 'foods.json 不存在', ...cell(B, OUT, () => fs.rmSync(path.join(wt, 'data/foods.json')), 'data/foods.json 不存在') },
        { unit: '暫存檔的位置被資料夾佔住', ...cell(B, OUT, occupyTmp(OUT), 'data/recipes.json.tmp', tmpDirIntact) },
      ], 4);
    }

    if (!only || only === 'foods') {
      const B = 'build-foods.mjs', OUT = 'data/foods.json';
      const rawDir = path.join(wt, 'data/raw');
      const rows = JSON.parse(fs.readFileSync(RAW_MAIN, 'utf8'));
      const putRaw = (list) => { fs.mkdirSync(rawDir, { recursive: true }); fs.writeFileSync(path.join(rawDir, RAW_NAME), typeof list === 'string' ? list : JSON.stringify(list)); };
      const base = cell(B, OUT, () => putRaw(rows), null);
      const baseOk = base.code === 0;
      console.log(`build-foods｜基準（真實原始資料的複本）｜回傳 ${base.code}｜${baseOk ? '放行' : '沒放行——基準不綠，下面的結果不採信'}`);
      if (!baseOk) fail += 1;
      restore();
      const FIELDS = ['整合編號', '樣品名稱', '食品分類', '分析項', '每100克含量', '含量單位'];
      report('build-foods｜欄位改名', FIELDS.map((fld) => ({ unit: fld, ...cell(B, OUT, () => putRaw(rows.map((r) => { const { [fld]: v, ...rest } = r; return { ...rest, [`${fld}_改名`]: v }; })), fld) })), 6);
      const NUTRIENTS = ['熱量', '粗蛋白', '粗脂肪', '飽和脂肪', '總碳水化合物', '糖質總量', '膳食纖維', '鈉', '鉀', '磷', '鈣', '膽固醇'];
      report('build-foods｜營養素的列全部拿掉', NUTRIENTS.map((nut) => ({ unit: nut, ...cell(B, OUT, () => putRaw(rows.filter((r) => String(r['分析項'] ?? '').trim() !== nut)), `「${nut}」`) })), 12);
      const cats = [...new Set(JSON.parse(fs.readFileSync(path.join(wt, OUT), 'utf8')).foods.map((f) => f.cat))].sort();
      const rawCats = new Set(rows.map((r) => String(r['食品分類'] ?? '').trim()));
      console.log(`build-foods｜母體｜foods.json 的類別 ${cats.length} 個（原始資料裡找得到 ${cats.filter((c) => rawCats.has(c)).length} 個）`);
      if (!cats.length || cats.some((c) => !rawCats.has(c))) { console.log('    母體數量不符：有類別在原始資料裡找不到，拿掉那一類的列等於什麼都沒改'); fail += 1; }
      report('build-foods｜分類的列全部拿掉', cats.map((cat) => ({ unit: cat, ...cell(B, OUT, () => putRaw(rows.filter((r) => String(r['食品分類'] ?? '').trim() !== cat)), `「${cat}」`) })), cats.length);
      report('build-foods｜整體', [
        { unit: '原始資料資料夾不存在', ...cell(B, OUT, () => fs.rmSync(rawDir, { recursive: true, force: true }), 'data/raw') },
        { unit: '空陣列', ...cell(B, OUT, () => putRaw('[]'), '0 列') },
        { unit: 'JSON 壞掉', ...cell(B, OUT, () => putRaw('[{壞掉'), RAW_NAME) },
        { unit: '只給前 5%', ...cell(B, OUT, () => putRaw(rows.slice(0, Math.floor(rows.length * 0.05))), '少了') },
        { unit: '暫存檔的位置被資料夾佔住', ...cell(B, OUT, () => { putRaw(rows); occupyTmp(OUT)(); }, 'data/foods.json.tmp', tmpDirIntact) },
      ], 5);
    }
  } finally {
    execFileSync('git', ['-C', repo, 'worktree', 'remove', '--force', wt]);
  }
  console.log(fail ? `buildguard 驗法：有 ${fail} 組沒全擋（或基準不綠、母體數量不符）` : 'buildguard 驗法：每一格都擋下、理由在錯誤訊息的位置點名那個單位、輸出檔沒動、沒有堆疊');
  // 登記（推送閘門第零關之二比對）
  const d = finalizeRegistration(repo, { only, fail, revFull, headAtStart });
  console.log(`登記｜${d.action === 'register' ? '已登記' : d.action === 'delete' ? '已刪掉' : '沒動'}｜${d.why}`);
  return fail ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args[0] === '--compare' && args[1] && args[2]) process.exitCode = compare(args[1], args[2]);
  else if (args.includes('--controls')) {
    const cs = selfControls(); for (const c of cs) console.log(`對照組｜${c.ok ? '對' : '錯'}｜${c.label}`);
    process.exitCode = cs.every((c) => c.ok) ? 0 : 1;
  } else {
    const rev = args[args.indexOf('--rev') + 1];
    if (!args.includes('--rev') || !rev) { console.log('用法：--rev <commit> [--only recipes|foods]｜--compare <舊 log> <新 log>｜--controls'); process.exit(2); }
    process.exitCode = verify(rev, args.includes('--only') ? args[args.indexOf('--only') + 1] : null);
  }
}

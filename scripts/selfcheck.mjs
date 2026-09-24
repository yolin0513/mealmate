// 公開前自查（共用慣例 §2.4、§2.5 第一關）：查「這次要推的每一個 commit 會公開的東西」。
// 用法：node scripts/selfcheck.mjs [遠端名，預設 origin] 或 node scripts/selfcheck.mjs --range <A..B>。由 scripts/pushgate.sh 呼叫（它先 fetch，範圍才照遠端的實際狀態算）；也可以單獨跑。
//
// 查什麼（範圍＝<遠端>/main..HEAD 的每一個 commit，不是只比兩端）：
//   · 新增行：照 diff 的結構抽——`diff --git` 到第一個 `@@` 之間是檔頭（含 `+++ b/檔名`），跳過；`@@` 之後以 `+` 開頭的才是內容。
//     （2026-09-24 以前是「以 `+++` 開頭就跳過」：內容本身以 `++` 開頭的行加上 diff 的 `+` 也變成 `+++…`，被當成檔頭丟掉。）
//   · commit 訊息、作者與提交者的名字與信箱（另外取；`--format=` 會把它們整個拿掉）。
//   · 抽出的新增行數用獨立的來源核對：`git log --numstat` 第一欄的加總必須**等於**抽出的行數（抽多、抽少都停）——
//     換個環境、git 輸出格式變了、抽取默默變少，這一道都接得住。
// 回傳值：通過 0；有命中、任何一類的對照組沒命中（檢查器壞了）、範圍裡沒有 commit、抽取與 numstat 對不上、取不到訊息與作者欄、或丟例外 → 非 0。
// 只刪不增的 commit（新增行 0、numstat 也 0）照常檢查訊息與作者欄，沒命中就通過。
// 推送那一行要用回傳值擋，不要接管線。沒有不能公開的樣式或黑名單：使用者名稱執行時從環境變數取，email 的對照組當場組成。
// 路徑照附錄 A：磁碟機開頭的路徑、帶使用者名稱的家目錄路徑擋；用 ~、$HOME 寫的泛稱不擋。
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// --range <A..B>：只給「拿真實資料確認不會誤擋」這種一次性的檢查用（例如 HEAD~30..HEAD）；閘門不帶，照舊是 <遠端>/main..HEAD
// 「執行 git」是參數（F10 第 1b 點）：測試傳一個會回壞輸出或會失敗的版本，才造得出「抽取對不上」「取不到訊息與作者欄」這些真的 git 造不出來的失敗分支
export const realGit = (args) => execFileSync('git', ['-c', 'core.quotepath=off', ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

/** 照 diff 的結構抽新增行（去掉開頭的 +）。檔頭不算；@@ 之後以 + 開頭的才是內容。 */
function addedLinesOf(diffText) {
  const out = [];
  let inHunk = false;
  for (const l of diffText.split('\n')) {
    if (l.startsWith('diff --git ')) { inHunk = false; continue; }
    if (l.startsWith('@@')) { inHunk = true; continue; }
    if (inHunk && l.startsWith('+')) out.push(l.slice(1));
  }
  return out;
}

/** `git log --numstat --format=` 的輸出 → 新增行數加總（二進位檔是 -，不算）。 */
function numstatAdded(numstatText) {
  let n = 0;
  for (const l of numstatText.split('\n')) {
    const m = /^(\d+)\t/.exec(l);
    if (m) n += Number(m[1]);
  }
  return n;
}

/** 回 true＝通過。git 丟例外就讓它丟出去（CLI 那邊以未處理例外結束、回非 0——故障時停下）。 */
export function selfcheck(range, git = realGit, log = console.log) {
  const commits = git(['rev-list', range]).split('\n').filter(Boolean);
  const added = addedLinesOf(git(['log', '-p', '--no-color', '--format=', '-U0', range]));
  const numstat = numstatAdded(git(['log', '--numstat', '--format=', range]));
  const meta = git(['log', '--format=%B%n%an <%ae>%n%cn <%ce>', range]).split('\n').filter((l) => l.trim());
  log(`查了：commit ${commits.length} 個；新增行 ${added.length} 行（numstat ${numstat} 行）；commit 訊息與作者欄 ${meta.length} 行`);

  let ok = true;
  if (commits.length === 0) { log('範圍裡沒有 commit：沒有東西可推，當成失敗（避免查錯範圍還顯示通過）'); ok = false; }
  if (added.length !== numstat) { log(`抽取壞了：抽出的新增行 ${added.length} 行，numstat 是 ${numstat} 行（對不上就停，不是「有命中」）`); ok = false; }
  if (commits.length > 0 && meta.length === 0) { log('取不到 commit 訊息與作者欄：範圍裡有 commit，每個 commit 一定有作者欄，當成失敗'); ok = false; }

  const user = process.env.USERNAME || process.env.USER || '';
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const checks = {
    金鑰或token: /(sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|(api[_-]?key|secret|token)\s*[:=]\s*['"][^'"]{12,})/i,
    email: { test: (s) => (s.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || []).some((m) => !/@(users\.noreply\.github\.com|anthropic\.com)$/i.test(m)) },
    本機使用者名稱: user ? new RegExp(esc(user), 'i') : { test: () => { throw new Error('取不到使用者名稱'); } },
    磁碟機或家目錄路徑: /(\b[A-Za-z]:[\\/]|\/(Users|home)\/[^\s/]+)/,
  };
  // 對照組：當下組出來的合成樣本，跑的是同一個檢查（共用慣例 §5.3）；不寫進任何檔
  const fakeMail = ['someone', 'example-mail.test'].join('@');
  const controls = {
    金鑰或token: ['ghp_' + 'A'.repeat(30)],
    email: [fakeMail, 'Someone Else <' + fakeMail + '>'],
    本機使用者名稱: ['path ' + user + ' here'],
    磁碟機或家目錄路徑: ['E:' + '\\' + 'Foo', '/' + 'home' + '/someone/x'],
  };
  for (const [name, re] of Object.entries(checks)) {
    const ctl = controls[name].every((c) => re.test(c));
    const inAdded = added.filter((l) => re.test(l)).length;
    const inMeta = meta.filter((l) => re.test(l)).length;
    log(`${name}：對照組命中=${ctl}，新增行命中=${inAdded}，commit 訊息或作者欄命中=${inMeta}`);
    if (!ctl) ok = false;
    if (inAdded) { log(`  命中｜${name}｜來源：新增行 ${inAdded} 行`); ok = false; }
    if (inMeta) { log(`  命中｜${name}｜來源：commit 訊息或作者欄 ${inMeta} 行`); ok = false; }
  }
  // 泛稱路徑不該被擋（附錄 A：~、$HOME 不算）——反向的對照：擋了就是樣式寫太寬
  const generic = '~' + '/.cache/x';
  if (checks.磁碟機或家目錄路徑.test(generic)) { log('磁碟機或家目錄路徑：連泛稱路徑也擋（樣式太寬）'); ok = false; }
  log(ok ? '自查通過' : '自查不通過');
  return ok;
}

/**
 * node 這一層的入口拒絕（補充說明十一第 4 點；閘門 bash 那一層同樣的規則）：GIT_ 開頭的環境變數 git 自己認得，
 * 設了（空字串也算）整個自查會對著別的 repo 或設定跑。前綴寫法、不分大小寫，只放行只影響互動介面的三個。
 * 環境變數從參數傳進來（F10：判斷邏輯抽成純函式，測試傳自己造的 env）。
 */
export const GIT_ENV_ALLOW = ['GIT_EDITOR', 'GIT_SEQUENCE_EDITOR', 'GIT_PAGER'];
export function gitEnvProblems(env) {
  return Object.keys(env).filter((k) => k.toUpperCase().startsWith('GIT_') && !GIT_ENV_ALLOW.includes(k.toUpperCase())).sort();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const bad = gitEnvProblems(process.env);
  if (bad.length) { console.log(`【擋下：執行環境】${bad.join('、')} 有設定：git 自己認得 GIT_ 開頭的變數，自查會對著別的 repo 或設定跑；先 unset 再跑`); process.exit(1); }
  const argv = process.argv.slice(2);
  const ri = argv.indexOf('--range');
  const range = ri >= 0 ? argv[ri + 1] : `${argv[0] || 'origin'}/main..HEAD`;
  if (!selfcheck(range)) process.exitCode = 1;
}

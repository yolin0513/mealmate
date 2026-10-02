// 入庫的證據要能複核（共用慣例 v11.4 §5.7，2026-10-02）：突變執行器的原始 log 留在 .logs/（不進版控），
// 進版控的證據檔由這支從 log 逐項產生——每一條突變一行，不手寫、不只留總數（JLPT 實例：29 條只剩總數、原始 log 已不在）。
//
// 用法：node scripts/evidence.mjs <執行器的 log> [--elapsed 秒數] [--ledger 帳本路徑] [--out 輸出路徑]
//   沒給 --out：寫到 docs/evidence/<日期>_<commit>_<跑法>_mutations.md
// 三道擋（任一道不過就回非 0、一個檔都不寫）：
//   1. 清洗的雙向對照組：含本機路徑、email、本機使用者名稱的合成樣本要被洗掉；帶分類資訊的樣本要原封不動（不能連分類一起洗光）
//   2. 行數＝條數：證據的列數要等於執行器印的「選了 N 條」；少了、多了都停，並講明差幾條
//   3. 跟帳本核對：「抓到」的那幾條，帳本那一條的 last.red 必須是 true；「情境未成立」的必須是不算數（counted=false）——對不上就停
// 每一列：判定（抓到／紅錯地方／沒紅／情境未成立／還原失敗／過期／其他）、哪一支測試、突變名稱、結束方式、秒數（後兩項取自帳本）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

// ---- 清洗 ----
const STOP = '\\s|，。；：）」】『』"\'<>`';
const escapeRx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function cleanText(s, user = os.userInfo().username) {
  let t = String(s);
  t = t.replace(new RegExp(`[A-Za-z]:[\\\\/][^${STOP}]*`, 'g'), '<本機路徑>');               // 磁碟機路徑（反斜線或斜線）
  t = t.replace(new RegExp(`/(?:[a-z]/)?(?:Users|home)/[^${STOP}]*`, 'gi'), '<本機路徑>');    // Git Bash 的磁碟機目錄、macOS 與 Linux 的家目錄
  t = t.replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, (m) => (/@users\.noreply\.github\.com$/.test(m) ? m : '<email>'));
  if (user && user.length >= 2) t = t.replace(new RegExp(escapeRx(user), 'g'), '<使用者>');
  return t;
}
/** 清洗的雙向對照組：髒的要洗乾淨、帶分類資訊的要原封不動。回問題陣列，空的＝清洗正常 */
export function cleanControls(user = os.userInfo().username) {
  const problems = [];
  // 合成樣本在執行時才組出來（不在原始碼裡寫下要擋的內容）
  const fakeUser = user && user.length >= 2 ? user : 'someone';
  // 使用者名稱也單獨出現一次（不在路徑裡）：只靠路徑規則洗掉的話，「使用者名稱」那一條規則壞了看不出來
  const dirty = `log 在 ${['C:', 'Users', fakeUser, 'proj', 'x.log'].join('\\')}、也在 ${['', 'c', 'Users', fakeUser, 'y'].join('/')}；跑的人是 ${fakeUser}；聯絡 ${['tester', 'example-mail.test'].join('@')}`;
  const cd = cleanText(dirty, fakeUser);
  if (cd.includes(fakeUser) || /[A-Za-z]:\\/.test(cd) || /\/Users\//i.test(cd) || cd.includes('@example-mail.test')) problems.push(`髒的樣本沒洗乾淨：${cd}`);
  const keep = '【resume-verify】護欄：還原紀錄被移掉也照跑｜情境未成立｜不算數：resume-verify 情境未成立（113 秒）｜.logs 的相對路徑 a/b.log';
  if (cleanText(keep, fakeUser) !== keep) problems.push(`帶分類資訊的樣本被改掉了：${cleanText(keep, fakeUser)}`);
  return problems;
}

// ---- 解析執行器的 log ----
const VERDICT_OF = [
  ['預期清單過期：', '預期清單過期'],
  ['不算數：', '情境未成立'],
  ['紅了，但紅的不是', '紅錯地方'],
  ['居然還是綠的', '沒紅'],
  ['沒有還原成功', '還原失敗'],
  ['這條突變過期了', '過期'],
];
export function parseRunnerLog(text) {
  const lines = String(text).split('\n');
  const sel = lines.map((l) => /選了 (\d+) 條突變（共 (\d+)）.*?跑法 ([\w-]+)/.exec(l)).find(Boolean);
  // 「這一次：日期、commit、跑法」那一行（2026-10-02 起執行器一定印）；舊的 log 只有資源紀錄那一行帶得到
  const run = lines.map((l) => /這一次：(\d{4}-\d{2}-\d{2})、commit ([0-9a-f]{7,40}(?:\+dirty)?)、跑法 ([\w-]+)/.exec(l)).find(Boolean);
  const res = run ?? lines.map((l) => /資源紀錄：.*?(\d{4}-\d{2}-\d{2})_([0-9a-f]{7,40}(?:-dirty)?)_([\w-]+)_reslog/.exec(l)).find(Boolean);
  const peak = lines.map((l) => /資源紀錄的峰值：(.+)$/.exec(l)).find(Boolean);
  const rows = [];
  let inMut = false;
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].includes('— 逐條突變 —')) { inMut = true; continue; }
    if (!inMut) continue;
    const m = /^ {2}([✓✗]) 【([^】]+)】(.+?)\s*$/.exec(lines[i]);
    if (!m) continue;
    const detail = [];
    for (let j = i + 1; j < lines.length && /^ {6}/.test(lines[j]); j += 1) detail.push(lines[j].trim());
    const d = detail.join(' ');
    const verdict = m[1] === '✓' ? '抓到' : (VERDICT_OF.find(([k]) => d.includes(k))?.[1] ?? '其他（看原始 log）');
    rows.push({ test: m[2], name: m[3], verdict });
  }
  return { selected: sel ? Number(sel[1]) : null, total: sel ? Number(sel[2]) : null, mode: sel?.[3] ?? res?.[3] ?? null, date: res?.[1] ?? null, commit: res?.[2] ?? null, peak: peak?.[1] ?? null, rows };
}

/** 擋 2、擋 3：回問題陣列 */
export function evidenceProblems(parsed, ledger) {
  const out = [];
  // log 沒寫日期與 commit（舊的 log、沒開資源紀錄的那一次）：取帳本裡這幾列的 last——全部一致才採用，不一致就照實寫不明
  if (!parsed.date || !parsed.commit) {
    const ds = new Set(); const cs = new Set();
    for (const r of parsed.rows) { const l = ledger?.entries?.[r.name]?.last; if (l) { ds.add(l.date); cs.add(l.commit); } }
    if (!parsed.date && ds.size === 1) parsed.date = [...ds][0];
    if (!parsed.commit && cs.size === 1) parsed.commit = [...cs][0];
  }
  if (parsed.selected === null) out.push('log 裡找不到「選了 N 條突變」——不知道母體有幾條');
  else if (parsed.rows.length !== parsed.selected) out.push(`證據 ${parsed.rows.length} 列，執行器選了 ${parsed.selected} 條——差 ${parsed.selected - parsed.rows.length} 條（log 不完整，或解析漏了）`);
  for (const r of parsed.rows) {
    const l = ledger?.entries?.[r.name]?.last;
    if (!l) { out.push(`「${r.name}」帳本裡沒有紀錄`); continue; }
    if (r.verdict === '抓到' && l.red !== true) out.push(`「${r.name}」log 說抓到，帳本 red=${l.red}`);
    if (r.verdict === '情境未成立' && l.counted !== false) out.push(`「${r.name}」log 說情境未成立，帳本 counted=${l.counted}`);
  }
  return out;
}

export function renderEvidence(parsed, ledger, { elapsed = null, user } = {}) {
  const c = (s) => cleanText(s ?? '', user);
  const count = (v) => parsed.rows.filter((r) => r.verdict === v).length;
  const head = [
    `# 突變證據：${c(parsed.date ?? '日期不明')}、${c(parsed.commit ?? 'commit 不明')}、跑法 ${c(parsed.mode ?? '不明')}`,
    '',
    `> 由 \`scripts/evidence.mjs\` 從執行器的原始 log 逐項產生（原始 log 在 \`.logs/\`，不進版控）。每一條突變一列；結束方式與秒數取自帳本 \`scripts/mutation-ledger.json\`。`,
    '',
    `- 選了 ${parsed.selected} 條（清單共 ${parsed.total} 條）；證據 ${parsed.rows.length} 列`,
    `- 情境成立：抓到 ${count('抓到')}、紅錯地方 ${count('紅錯地方')}、沒紅 ${count('沒紅')}、還原失敗 ${count('還原失敗')}、過期 ${count('過期')}；情境未成立（不算數）${count('情境未成立')}；其他 ${count('其他（看原始 log）')}`,
    `- 總耗時：${elapsed === null ? '（沒有給）' : `${elapsed} 秒`}`,
    `- 資源紀錄的峰值：${c(parsed.peak ?? '（log 裡沒有，這一次沒開資源紀錄）')}`,
    '',
    '| # | 判定 | 測試 | 突變 | 結束方式 | 秒數 |',
    '|---|---|---|---|---|---|',
  ];
  const body = parsed.rows.map((r, i) => {
    const l = ledger?.entries?.[r.name]?.last ?? {};
    return `| ${i + 1} | ${r.verdict} | ${c(r.test)} | ${c(r.name).replace(/\|/g, '／')} | ${c(l.kind ?? '—')} | ${l.seconds ?? '—'} |`;
  });
  return { text: `${[...head, ...body].join('\n')}\n`, rowCount: body.length };
}

function main() {
  const args = process.argv.slice(2);
  const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
  const logFile = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
  if (!logFile || !fs.existsSync(logFile)) { console.log(`✗ 要給執行器的 log（${logFile ?? '沒給'}）`); process.exit(1); }
  const cc = cleanControls();
  if (cc.length) { console.log(`✗ 清洗的對照組不過（清洗壞了，不寫證據檔）：${cc.join('｜')}`); process.exit(2); }
  const ledgerPath = opt('--ledger') ?? path.join(ROOT, 'scripts/mutation-ledger.json');
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  const parsed = parseRunnerLog(fs.readFileSync(logFile, 'utf8'));
  const problems = evidenceProblems(parsed, ledger);
  if (problems.length) { console.log(`✗ 證據對不上，不寫檔：${problems.join('｜')}`); process.exit(1); }
  const { text, rowCount } = renderEvidence(parsed, ledger, { elapsed: opt('--elapsed') });
  if (rowCount !== parsed.selected) { console.log(`✗ 寫出來的列數 ${rowCount} ≠ 選了 ${parsed.selected} 條，不寫檔`); process.exit(1); }
  const out = opt('--out') ?? path.join(ROOT, 'docs/evidence', `${parsed.date ?? 'nodate'}_${(parsed.commit ?? 'nocommit').replace(/[-+]dirty$/, '')}_${parsed.mode ?? 'nomode'}_mutations.md`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, text, 'utf8');
  console.log(`證據檔：${path.relative(ROOT, out)}（${rowCount} 列＝選了 ${parsed.selected} 條；清洗的對照組兩個方向都過）`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();

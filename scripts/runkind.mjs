// 跑一支測試、分辨它是怎麼結束的（2026-10-01）。給 mutationtest 用。
//
// 以前 mutationtest 對「逾時被殺」「根本沒跑起來」「崩潰」「斷言失敗」一律只記成「沒通過」：
// · 基準段：assertaudit 逾時被殺，只印出輸出的開頭，看起來像斷言失敗；
// · 突變段更糟：沒寫 expect 的突變，逾時會被當成「紅了」——一條根本沒被驗到的突變，被記成「抓到了」。
// 失敗的種類（kind）：
//   pass     回傳 0
//   assert   回傳非 0，輸出裡有 ✗（某條斷言失敗）——只有這一種是「紅在斷言」
//   crash    回傳非 0，輸出裡沒有 ✗（未處理的例外之類）——2026-10-02 起不算數（情境未成立），見 UNCOUNTED_KINDS
//   timeout  超過時限被殺（execFileSync 的 code 是 ETIMEDOUT）
//   signal   被外部的訊號殺掉（不是逾時）
//   spawn    程式根本沒跑起來（例如找不到執行檔、開不了子行程）
// 判斷順序照上面由下往上：先看有沒有跑起來、是不是逾時、是不是被殺，最後才看輸出。
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const KIND_LABELS = {
  pass: '通過',
  assert: '斷言失敗',
  crash: '崩潰（輸出裡沒有任何 ✗；被改壞的程式沒跑完，不是那道檢查發現了它）',
  timeout: '逾時被殺',
  signal: '被外部訊號殺掉',
  spawn: '沒跑起來',
  noscenario: '情境未成立（要測的狀況這一次沒有發生）',
};
/**
 * 這幾種代表「測試沒有完整跑完」或「什麼都沒量到」：不能拿來判斷突變有沒有被抓到——不算紅、不算通過、不算數，下一次要重跑。
 * noscenario（2026-10-02 Dispatch）：測試自己宣告「要測的那個狀況這一次沒有發生」（例如殺程序錯過了時間窗）。
 * 它跟「紅錯地方」意思相反：紅錯地方是情境成立、被別條擋下；情境未成立是這次什麼都沒量到——不能偽裝成「情境成立且紅了」。
 */
// crash（2026-10-02 Dispatch、共用慣例 v11.4 §5.20）：被改壞的程式崩潰，證明的是「它崩潰了」，不是「那道檢查發現了它」——
// 被別的東西碰巧擋下的一律算沒擋。抓到只有一種：被改壞的程式完整跑完、某條斷言印出失敗（assert）。
export const UNCOUNTED_KINDS = new Set(['timeout', 'signal', 'spawn', 'noscenario', 'crash']);
/** 測試宣告情境未成立的那一行要以這個開頭（單獨一行；不用 ✗，免得被當成斷言失敗） */
export const NO_SCENARIO_MARK = '⊘ 情境未成立';
export function hasNoScenario(out) {
  return String(out ?? '').split('\n').some((l) => l.trimStart().startsWith(NO_SCENARIO_MARK));
}

/** 從 execFileSync 丟出的例外判斷種類（純函式；e 沒有就是通過） */
export function classifyRun(e) {
  if (!e) return 'pass';
  if (e.code === 'ETIMEDOUT') return 'timeout';
  if (e.signal) return 'signal';
  if (e.status === null || e.status === undefined) return 'spawn';
  const out = `${e.stdout ?? ''}\n${e.stderr ?? ''}`;
  if (hasNoScenario(out)) return 'noscenario';                       // 宣告了情境未成立：就算也有 ✗，那些 ✗ 量的不是要測的東西
  // 只認以 ✗ 開頭的行（2026-10-02）：通過的行（✓ …）訊息裡提到 ✗ 的，不是某條斷言紅了
  return out.split('\n').some((l) => l.trimStart().startsWith('✗')) ? 'assert' : 'crash';
}

/** 跑一支程式：回 { passed, kind, out, seconds }。exe 預設是目前的 node（測試可以傳別的，造「沒跑起來」）。 */
// inJob（2026-10-08，v11.6 §5.19）：Windows 上經 scripts/jobrun.mjs 開——逾時殺的是 jobrun，Job 關閉時它底下整棵樹（含 Git Bash 開的、
// detached 開的）一起被收掉。只有執行器跑測試時打開；doctest 裡幾秒時限的小探針不打開（Job 每次多約 0.85 秒，會吃掉很短的時限）
const JOBRUN = path.join(path.dirname(fileURLToPath(import.meta.url)), 'jobrun.mjs');
export function runProgram(args, { cwd, timeoutMs, exe = process.execPath, inJob = false } = {}) {
  const t0 = Date.now();
  if (inJob && process.platform === 'win32') { args = [JOBRUN, exe, ...args]; exe = process.execPath; }
  try {
    const out = execFileSync(exe, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], timeout: timeoutMs, encoding: 'utf8' });
    // 回傳 0 但宣告了情境未成立：也不算通過（「這次什麼都沒量到」不能被記成綠）
    if (hasNoScenario(out)) return { passed: false, kind: 'noscenario', out, seconds: Math.round((Date.now() - t0) / 1000) };
    return { passed: true, kind: 'pass', out, seconds: Math.round((Date.now() - t0) / 1000) };
  } catch (e) {
    return { passed: false, kind: classifyRun(e), out: `${e.stdout ?? ''}\n${e.stderr ?? ''}`, seconds: Math.round((Date.now() - t0) / 1000) };
  }
}

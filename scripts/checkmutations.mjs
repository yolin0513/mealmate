// 秒級的突變健檢：不跑任何測試，只看 mutationtest.mjs 的突變清單本身還有沒有效。
//   · find 字串拿去目標檔案數一次：剛好一次才算有效；0 次＝過期（程式改了、突變沒跟上），≥2 次＝改到不只一個地方。
//   · find 與 replace 不能一樣；指定的測試要存在。
//   · 帶 expect 的，expect 要是對應測試原始碼裡的一段字面（共用慣例 v6 §5.9；2026-09-23 抄 StockDiary 的 expectProblems）。
//     expect 過期（斷言訊息改了、expect 沒跟上）時，那條突變會「紅錯地方」——以前要等整套跑到那一條才看得到。
//   · 沒帶 expect 的舊突變只准變少（EXPECT_MISSING_MAX）：新加的突變一律要帶 expect。
// 給 assertaudit 呼叫，也可以自己跑：`node scripts/checkmutations.mjs`。純函式給 doctest 驗（含對照組）。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

/**
 * 沒帶 expect 的突變最多幾條（2026-09-23 盤點是 333 條：v0.36.0 以前的舊突變）。
 * 只准變少：新突變一律帶 expect。替舊突變補上 expect 之後，把這個數字跟著調低。
 * （StockDiary 用陣列裡的位置標記；本 App 的新突變常插在各主題段落中間，位置標記擋不到，所以改用計數。）
 */
export const EXPECT_MISSING_MAX = 333;

/** 把 mutationtest.mjs 的 MUTATIONS 陣列整段抽出來當成模組求值（它只是字面資料，沒有副作用）。找不到回 null。 */
export function loadMutations(src) {
  const start = src.indexOf('const MUTATIONS = [');
  const end = src.indexOf('\n];', start);
  if (start < 0 || end < 0) return null;
  const literal = src.slice(start + 'const MUTATIONS = '.length, end + 2);
  // eslint-disable-next-line no-new-func
  return new Function(`return ${literal};`)();
}

/**
 * 一條突變的 expect 有什麼問題（沒有回 []）。read(相對路徑) → 檔案內容或 null。
 * 沒帶 expect 的跳過；空字串、測試檔不存在、測試原始碼裡找不到那段字，都算問題。
 * 注意：比的是**原始碼的字面**。訊息裡 `${…}` 插值出來的字、跳脫的引號，原始碼裡長得不一樣——
 * expect 要挑原始碼裡照字寫著的那一段（例如訊息開頭的固定標籤，v6 §5.9）。
 */
export function expectProblems(mut, read) {
  if (mut.expect == null) return [];
  if (typeof mut.expect !== 'string' || mut.expect.trim() === '') return ['expect 是空的'];
  const testSrc = read(`scripts/${mut.test}.mjs`);
  if (testSrc == null) return [`指定的測試 scripts/${mut.test}.mjs 不存在`];
  return testSrc.includes(mut.expect) ? [] : [`expect「${mut.expect}」在 scripts/${mut.test}.mjs 裡找不到`];
}

/** 沒帶 expect 的突變超過上限時回一句話，沒超過回 null。 */
export function missingExpectOverLimit(mutations, max = EXPECT_MISSING_MAX) {
  const n = mutations.filter((m) => m.expect == null).length;
  return n > max ? `沒帶 expect 的突變有 ${n} 條，超過上限 ${max}：新加的突變一律要帶 expect` : null;
}

const readRel = (rel) => {
  const p = path.join(ROOT, rel);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
};

function main() {
  const MUTATIONS = loadMutations(fs.readFileSync(path.join(ROOT, 'scripts/mutationtest.mjs'), 'utf8'));
  if (!MUTATIONS) { console.log('STALE 找不到 MUTATIONS 陣列'); process.exit(1); }
  // 清單是空的＝什麼都沒檢查（v9 F1，2026-09-24：以前印「TOTAL 0、STALECOUNT 0」、回 0）
  if (MUTATIONS.length === 0) { console.log('STALE 突變清單是空的（一條都沒有，什麼都沒檢查）'); console.log('TOTAL 0'); console.log('STALECOUNT 1'); process.exit(1); }
  let stale = 0;
  for (const m of MUTATIONS) {
    const file = path.join(ROOT, m.file);
    if (!fs.existsSync(file)) { console.log(`STALE ${m.name}：找不到檔案 ${m.file}`); stale += 1; continue; }
    const body = fs.readFileSync(file, 'utf8');
    const n = body.split(m.find).length - 1;
    if (n !== 1) { console.log(`STALE ${m.name}（${m.file}）：find 出現 ${n} 次`); stale += 1; }
    if (m.find === m.replace) { console.log(`STALE ${m.name}：find 與 replace 一模一樣，改了等於沒改`); stale += 1; }
    const testFile = path.join(ROOT, 'scripts', `${m.test}.mjs`);
    if (!fs.existsSync(testFile)) { console.log(`STALE ${m.name}：指定的測試 ${m.test} 不存在`); stale += 1; }
    for (const p of expectProblems(m, readRel)) { console.log(`STALE ${m.name}：${p}`); stale += 1; }
  }
  const over = missingExpectOverLimit(MUTATIONS);
  if (over) { console.log(`STALE ${over}`); stale += 1; }
  console.log(`TOTAL ${MUTATIONS.length}`);
  console.log(`EXPECTCOUNT ${MUTATIONS.filter((m) => m.expect != null).length}`);
  console.log(`STALECOUNT ${stale}`);
  // 有過期的就回傳非 0：只印字、回 0 的話，接在 `&&` 後面的指令照樣會跑（2026-09-23 推送閘門同一類的坑）
  if (stale > 0) process.exitCode = 1;
}

// 直接執行才跑（doctest 只 import 純函式）
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

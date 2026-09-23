// 假斷言健檢（npm run assertaudit）。**不是抽樣，是全掃。**
//
// 一條「跑得過」的斷言不等於它在檢查東西。這支把整個測試套件的斷言攤開來看，找六種形狀：
//
//   1. **母體太小**：everyOf／noneOf 的母體 ≤ 2 —— 檢查兩個東西跟檢查一個差不多，容易是寫死的樣本
//   2. **常數述詞**：`() => true`、`(x) => true` 這種，永遠不會失敗卻計進通過數
//   3. **ok(true, …)**：說明行混進斷言數（要用 note()）
//   4. **eq(x, x)**：左右是同一段程式碼，恆真
//   5. **regex 跳脫壞掉**：測試碼裡出現 `\\s`、`\\d` 這種雙反斜線（經過 shell heredoc 的痕跡，永遠不命中）
//   6. **突變過期**：每一條突變的 find 字串在目標檔案裡必須**剛好出現一次**
//
// 前三種要跑過測試才知道母體多大，所以先用 MM_AUDIT=1 把每條斷言（含母體大小）寫成 JSONL 再讀。
// 用法：`npm run assertaudit`（會先跑一次全部測試，約 25 分鐘）；
//      已經有 assert-audit.jsonl 的話 `npm run assertaudit -- --reuse` 只做分析。

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ok, eq, section, done, note, everyOf } from './tap.mjs';
import { auditTargets, orphanTests } from './sincefull.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const OUT = path.join(ROOT, 'assert-audit.jsonl');
const reuse = process.argv.includes('--reuse');

// 掃哪些測試：**只認 package.json 測試鏈登記過的**（sincefull.auditTargets）。
// 以前是「scripts/*.mjs 扣掉略過清單」，新加的工具沒進略過清單就會紅——2026-09-19 sincefull.mjs、2026-09-24 selfcheck.mjs 各一次。
// 改成登記制之後，丟一個工具進 scripts/ 不會被當成測試；新測試忘了登記的，由下面的「孤兒」那一條擋。
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const scriptFiles = fs.readdirSync(path.join(ROOT, 'scripts')).filter((f) => !f.startsWith('.'));
const testFiles = auditTargets(pkg, scriptFiles);

section('前置：把每條斷言與它的母體大小記下來');
ok(testFiles.length >= 20, `${testFiles.length} 支測試要掃（package.json 測試鏈）：${testFiles.map((f) => f.replace('.mjs', '')).join('、')}`);
everyOf(testFiles, (f) => scriptFiles.includes(f), '測試鏈登記的每一支測試檔都存在');
eq(orphanTests(pkg, scriptFiles), [], '沒有「檔名像測試、卻沒登記進測試鏈」的孤兒（mutationtest 刻意不在鏈裡，除外）');
if (!reuse) {
  fs.rmSync(OUT, { force: true });
  for (const f of testFiles) {
    try {
      execFileSync(process.execPath, [path.join(ROOT, 'scripts', f)], {
        cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], timeout: 15 * 60 * 1000,
        env: { ...process.env, MM_AUDIT: '1', MM_AUDIT_OUT: OUT },
      });
    } catch (e) {
      console.log(`  · ${f} 失敗（仍然收得到它跑到失敗前的斷言）：${String(e.message).slice(0, 80)}`);
    }
  }
}
ok(fs.existsSync(OUT), 'assert-audit.jsonl 產生了');
const rows = fs.readFileSync(OUT, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const asserts = rows.filter((r) => r.kind !== 'section');
ok(asserts.length >= 900, `（母體）一共 ${asserts.length} 條斷言，來自 ${new Set(rows.map((r) => r.test)).size} 支測試`);
everyOf(testFiles, (f) => rows.some((r) => r.test === f.replace('.mjs', '')), '每一支測試都有把斷言寫進來（沒有哪一支被漏掉）');

section('1. 母體太小的 everyOf／noneOf');
const populated = asserts.filter((r) => (r.kind === 'everyOf' || r.kind === 'noneOf') && typeof r.n === 'number');
ok(populated.length >= 150, `（母體）${populated.length} 條有母體的斷言`);
const tiny = populated.filter((r) => r.n <= 2);
note(`母體 ≤ 2 的有 ${tiny.length} 條：${tiny.slice(0, 12).map((r) => `${r.test}「${r.msg.slice(0, 26)}」n=${r.n}`).join('｜')}`);
eq(populated.filter((r) => r.n === 0).length, 0, '沒有任何 everyOf／noneOf 的母體是空的（tap.mjs 會直接判失敗，這裡再確認一次）');

section('2–4. 靜態形狀：常數述詞、ok(true)、eq(x, x)');
const src = new Map(testFiles.map((f) => [f, fs.readFileSync(path.join(ROOT, 'scripts', f), 'utf8')]));
const findAll = (rx) => {
  const hits = [];
  for (const [f, s] of src) {
    for (const m of s.matchAll(rx)) {
      const line = s.slice(0, m.index).split('\n').length;
      hits.push(`${f}:${line} ${m[0].replace(/\s+/g, ' ').slice(0, 70)}`);
    }
  }
  return hits;
};
const constPred = findAll(/(?:everyOf|noneOf)\([^;]*?=>\s*(?:true|false)\s*[,)]/g);
eq(constPred, [], '沒有「述詞永遠回 true／false」的 everyOf／noneOf');
const okTrue = findAll(/\bok\(\s*true\s*,/g);
eq(okTrue, [], '沒有 ok(true, …)（說明行要用 note()）');
const eqSame = [];
for (const [f, s] of src) {
  for (const m of s.matchAll(/\beq\(([^,]{3,60}),\s*([^,]{3,60}),/g)) {
    if (m[1].trim() === m[2].trim()) eqSame.push(`${f} ${m[0].slice(0, 60)}`);
  }
}
eq(eqSame, [], '沒有 eq(x, x) 這種左右同一段程式碼的恆真斷言');

section('5. regex 跳脫：測試碼裡不可以有 \\\\s 這種雙反斜線');
// 含 regex 的測試碼一律用 Write 工具寫檔（慣例 5）。經過 shell heredoc 的話 \\s 會變成 \\\\s：
// 不報錯、測試照樣綠，但那條 regex 永遠不命中。
const doubled = [];
for (const [f, s] of src) {
  // 只抓典型的壞掉形狀：兩個反斜線接 s／d／w／b（而且前面不再有反斜線 —— 否則那是
  // 「跳脫一個反斜線」後面剛好接普通字母，像字串字面值的 char class `[^'\\\n]`）。
  // 註解行不算（shelltest 的註解正好在講這件事）；真的要在字串裡寫兩個反斜線就加 audit-allow。
  for (const m of s.matchAll(/(?<!\\)\\\\[sdwbSDWB]/g)) {
    const line = s.slice(0, m.index).split('\n').length;
    const ctx = s.split('\n')[line - 1].trim().slice(0, 80);
    if (/audit-allow/.test(ctx) || ctx.startsWith('//') || ctx.startsWith('*') || ctx.startsWith('/*')) continue;
    doubled.push(`${f}:${line} ${ctx}`);
  }
}
eq(doubled, [], '測試碼裡沒有雙反斜線的 regex 跳脫');

section('6. 突變全部沒過期（find 字串在目標檔案剛好出現一次）');
// 這一條很重要：平常只跑 `--only <關鍵字>` 的子集，過期的突變躲在沒被選到的那些裡面。
// 過期＝那條斷言自從程式改動之後就沒有被證明過會紅。
// checkmutations 有過期時回傳非 0（2026-09-23 起）；照樣讀它的輸出，下面的斷言會把每一條列出來
let check;
try { check = execFileSync(process.execPath, [path.join(ROOT, 'scripts/checkmutations.mjs')], { cwd: ROOT, encoding: 'utf8' }); }
catch (e) { check = String(e.stdout ?? ''); }
const stale = check.split(/\r?\n/).filter((l) => l.startsWith('STALE '));
const total = Number(/TOTAL (\d+)/.exec(check)?.[1] ?? 0);
ok(total >= 100, `（母體）檢查了 ${total} 條突變`);
eq(stale, [], '每一條突變的 find 字串在目標檔案裡都剛好出現一次，指定的測試也都存在');

done('assertaudit');

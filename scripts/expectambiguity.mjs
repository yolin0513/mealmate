// 突變的 expect 有沒有歧義（2026-10-02 Dispatch 交辦；遊戲專案 225 條裡 31 條有歧義、StockDiary 312 條裡 18 條有歧義、33 條判斷不了）。
// 執行器的比對：失敗的那一行（以 ✗ 開頭）**裡面任何位置**含 expect 就算「紅在預期那一條」——比對中間，不是開頭。
// 所以一段 expect 若出現在測試原始碼裡好幾個斷言訊息中，那幾個裡任何一個紅了都算這一條被抓到。
//
// 靜態量法（每一條有 expect 的突變）：在它的測試檔（去掉整行註解之後）數 expect 出現在幾個「字串」裡：
//   沒問題    ＝剛好 1 處，而且在一般字串（'…' 或 "…"）裡
//   有歧義    ＝2 處以上（不論在哪一種字串裡）
//   判斷不了  ＝剛好 1 處，但在樣板字串（`…`）裡、或在資料陣列裡（同一行有好幾個字串、像 [名稱, 程式, 回傳, 理由] 的表）——
//               訊息在執行時才組出來、或一行字串產生好幾個斷言，靜態數不出會對到幾個斷言。**不併進「沒問題」**
//   找不到    ＝0 處（預期清單過期；checkmutations 會擋）
// 這是一次性的量測工具，結果只在輸出，不進任何測試鏈。附合成對照組：每一類一個樣本，對照組分錯就停、不印結果（§5.3）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadMutations } from './checkmutations.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

/** 一行裡每一個字串字面（含引號種類）。粗略的掃描：跳脫字元照算，不處理跨行字串 */
export function stringsInLine(line) {
  const out = [];
  let i = 0;
  while (i < line.length) {
    const q = line[i];
    if (q === "'" || q === '"' || q === '`') {
      let j = i + 1; let s = '';
      while (j < line.length && line[j] !== q) { if (line[j] === '\\') { s += line[j + 1] ?? ''; j += 2; } else { s += line[j]; j += 1; } }
      out.push({ q, s });
      i = j + 1;
    } else if (q === '/' && line[i + 1] === '/') break;
    else i += 1;
  }
  return out;
}

/** 回 { kind: 'ok'|'ambiguous'|'unknown'|'missing', hits } */
export function classifyExpect(expect, testSrc) {
  const lines = testSrc.split('\n').filter((l) => !l.trimStart().startsWith('//'));
  const hits = [];
  for (const l of lines) {
    const strs = stringsInLine(l);
    for (const s of strs) if (s.s.includes(expect)) hits.push({ q: s.q, line: l.trim().slice(0, 100), table: strs.length >= 3 && l.trimStart().startsWith('[') });
  }
  if (hits.length === 0) return { kind: 'missing', hits };
  if (hits.length >= 2) return { kind: 'ambiguous', hits };
  return { kind: hits[0].q === '`' || hits[0].table ? 'unknown' : 'ok', hits };
}

export function controls() {
  const src = [
    "ok(a, 'A1 只有一處');",
    "ok(b, 'B1 第一處');",
    "eq(c, d, 'B1 第二處也含');",
    'ok(e, `C1 ${n} 道`);',
    "  ['D1 表的一列', \"ok(1)\", 0, '理由'],",
    "// ok(z, 'E1 只在註解裡');",
  ].join('\n');
  const want = { 'A1 ': 'ok', 'B1 ': 'ambiguous', 'C1 ': 'unknown', 'D1 ': 'unknown', 'E1 ': 'missing' };
  return Object.entries(want).filter(([e, k]) => classifyExpect(e, src).kind !== k).map(([e, k]) => `${e}預期 ${k}、實際 ${classifyExpect(e, src).kind}`);
}

function main() {
  const bad = controls();
  if (bad.length) { console.log(`✗ 對照組分錯了（量法壞了，不印結果）：${bad.join('｜')}`); return 1; }
  console.log('對照組：五類各一個合成樣本，都分對');
  const muts = loadMutations(fs.readFileSync(path.join(ROOT, 'scripts/mutationtest.mjs'), 'utf8'));
  if (!muts?.length) { console.log('✗ 讀不到突變清單'); return 1; }
  const withE = muts.filter((m) => m.expect != null);
  const groups = { ok: [], ambiguous: [], unknown: [], missing: [] };
  const cache = new Map();
  for (const m of withE) {
    const f = path.join(ROOT, 'scripts', `${m.test}.mjs`);
    if (!cache.has(f)) cache.set(f, fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null);
    const src = cache.get(f);
    const r = src == null ? { kind: 'missing', hits: [] } : classifyExpect(m.expect, src);
    groups[r.kind].push({ m, r });
  }
  console.log(`母體：突變 ${muts.length} 條；帶 expect ${withE.length} 條、沒帶 ${muts.length - withE.length} 條；比對方式＝失敗那一行的任何位置含 expect（中間，不是開頭）`);
  console.log(`沒問題 ${groups.ok.length}｜有歧義 ${groups.ambiguous.length}｜判斷不了 ${groups.unknown.length}｜找不到 ${groups.missing.length}（合計 ${withE.length}）`);
  for (const [k, label] of [['ambiguous', '有歧義'], ['unknown', '判斷不了'], ['missing', '找不到']]) {
    for (const { m, r } of groups[k]) console.log(`  ${label}｜${m.test}｜${m.name}｜expect「${m.expect}」｜${r.hits.length} 處${r.hits.length ? `：${r.hits.slice(0, 3).map((h) => h.line).join(' ／ ')}` : ''}`);
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main();

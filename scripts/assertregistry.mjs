// 斷言登記表與「預期需要複審」（2026-10-02 Dispatch 選 A＋）。
//
// 為什麼：突變的 expect 是「失敗那一行的任何位置含這段字」。過期檢查（checkmutations、執行器開跑前）擋得住
// 「expect 提到已經不存在的斷言」，擋不住「測試後來多了斷言、這條突變的 expect 沒跟上」——新斷言可能也含這段字（歧義變大），
// 也可能是這條突變其實該紅在那裡。完整劃分（每條突變對全部斷言表態）不划算（見 STATUS），改成把母體戳上版本：
//   1. 登記表：每支測試檔裡每一個斷言呼叫（ASSERT_FNS 登記的函式，從呼叫開始到括號收齊）一筆，編號＝正規化內容的雜湊；
//      同一支檔裡兩筆內容完全一樣＝編號重複 → duplicates 列出來（兩個一模一樣的斷言，紅了分不出是哪一個）
//   2. 每條帶 expect 的突變，在 scripts/expect-review.json 記「寫（或複審）這條 expect 時，那支測試的斷言母體幾條、雜湊多少」
//   3. 開跑前（執行器）與 checkmutations 比對：母體變了、戳記還是舊的 → 「預期需要複審」，獨立的訊息、列出是哪幾條。
//      只報、不擋：複審可以分批做，重點是看得見。複審完用 --stamp 重新戳。
// 母體是**數出來的**（掃原始碼），不寫死。靜態掃描的已知限制：迴圈裡的一個呼叫在執行時是好幾個斷言，這裡算一筆；
// 斷言函式要登記在 ASSERT_FNS（登記制）——測試自己包的斷言函式沒登記就數不到。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadMutations } from './checkmutations.mjs';
import { classifyExpect } from './expectambiguity.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
export const REVIEW_FILE = 'scripts/expect-review.json';
// tap.mjs 的斷言＋resume-verify 自己的 step。新增斷言函式時登記在這裡
export const ASSERT_FNS = ['ok', 'eq', 'near', 'throws', 'noneOf', 'everyOf', 'detects', 'step'];

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const norm = (s) => s.replace(/\s+/g, ' ').trim();

/** 這個「/」是不是 regex 字面的開頭：前一個非空白字元是運算子或開括號（不是除號） */
function regexStarts(src, j) {
  let k = j - 1;
  while (k >= 0 && (src[k] === ' ' || src[k] === '\t')) k -= 1;
  return k < 0 || '(,=:[!&|?{};\n'.includes(src[k]);
}
/** regex 字面的結尾（含旗標前那個「/」）；字元類別 [...] 裡的「/」不算 */
function regexEnd(src, j) {
  let inClass = false;
  for (let k = j + 1; k < src.length; k += 1) {
    const c = src[k];
    if (c === '\\') { k += 1; continue; }
    if (c === '\n') return k - 1;
    if (inClass) { if (c === ']') inClass = false; continue; }
    if (c === '[') { inClass = true; continue; }
    if (c === '/') return k;
  }
  return src.length - 1;
}

/** 從 i（呼叫的左括號）掃到對應的右括號；跳過字串與樣板字串（含 ${} 巢狀）。回結束位置（含），收不齊回 -1 */
function callEnd(src, i) {
  let depth = 0;
  const stack = [];   // 樣板字串的巢狀
  for (let j = i; j < src.length; j += 1) {
    const c = src[j];
    const top = stack[stack.length - 1];
    if (top === '`') {
      if (c === '\\') { j += 1; continue; }
      if (c === '`') { stack.pop(); continue; }
      if (c === '$' && src[j + 1] === '{') { stack.push('${'); depth += 1; j += 1; continue; }
      continue;
    }
    if (c === "'" || c === '"') {
      let k = j + 1;
      while (k < src.length && src[k] !== c && src[k] !== '\n') { if (src[k] === '\\') k += 1; k += 1; }
      j = k; continue;
    }
    if (c === '`') { stack.push('`'); continue; }
    if (c === '/' && src[j + 1] === '/') { while (j < src.length && src[j] !== '\n') j += 1; continue; }
    if (c === '/' && regexStarts(src, j)) { j = regexEnd(src, j); continue; }
    if (c === '{' && (top === '${' || top === '{')) { stack.push('{'); depth += 1; continue; }
    if (c === '}' && top === '{') { stack.pop(); depth -= 1; continue; }
    if (c === '(' || c === '{' || c === '[') depth += 1;
    else if (c === ')' || c === '}' || c === ']') {
      depth -= 1;
      if (top === '${' && c === '}') { stack.pop(); continue; }
      if (depth === 0) return j;
    }
  }
  return -1;
}

/** 每個位置是不是在字串、樣板字串的字面部分或註解裡（那裡的「ok(」是資料，不是呼叫——例：探針的原始碼寫在字串裡） */
function codeMask(src) {
  const inText = new Uint8Array(src.length);
  const stack = [];   // '`' 或 '${'
  for (let j = 0; j < src.length; j += 1) {
    const c = src[j]; const top = stack[stack.length - 1];
    if (top === '`') {
      inText[j] = 1;
      if (c === '\\') { inText[j + 1] = 1; j += 1; continue; }
      if (c === '`') { stack.pop(); continue; }
      if (c === '$' && src[j + 1] === '{') { inText[j + 1] = 1; stack.push('${'); j += 1; }
      continue;
    }
    if (top === '${' && c === '}') { stack.pop(); continue; }
    if (c === "'" || c === '"') {
      let k = j; inText[k] = 1; k += 1;
      while (k < src.length && src[k] !== c && src[k] !== '\n') { inText[k] = 1; if (src[k] === '\\') { inText[k + 1] = 1; k += 1; } k += 1; }
      if (k < src.length) inText[k] = 1;
      j = k; continue;
    }
    if (c === '`') { inText[j] = 1; stack.push('`'); continue; }
    if (c === '/' && src[j + 1] === '/') { while (j < src.length && src[j] !== '\n') { inText[j] = 1; j += 1; } continue; }
    if (c === '/' && src[j + 1] !== '*' && regexStarts(src, j)) { const e = regexEnd(src, j); for (let k = j; k <= e; k += 1) inText[k] = 1; j = e; continue; }
    if (c === '/' && src[j + 1] === '*') { while (j < src.length && !(src[j] === '*' && src[j + 1] === '/')) { inText[j] = 1; j += 1; } inText[j] = 1; inText[j + 1] = 1; j += 1; continue; }
    if (c === '{' && top === '${') stack.push('{');
    else if (c === '}' && top === '{') stack.pop();
  }
  return inText;
}

/** 一支測試檔的斷言登記表：[{ id, text }]，加上 duplicates（內容完全一樣的那幾筆）與 unparsed（括號收不齊的呼叫位置） */
export function registryOf(src) {
  const rx = new RegExp(`(^|[^\\w.$])(${ASSERT_FNS.join('|')})\\(`, 'g');
  const entries = []; const unparsed = [];
  const mask = codeMask(src);
  for (const m of src.matchAll(rx)) {
    const start = m.index + m[1].length;
    if (mask[start]) continue;
    // 是函式定義（function ok(、const step = (）不是呼叫：只認前面不是 function 的
    if (/function\s+$/.test(src.slice(Math.max(0, start - 12), start))) continue;
    const open = start + m[2].length;
    const end = callEnd(src, open);
    if (end < 0) { unparsed.push(src.slice(start, start + 60)); continue; }
    const text = norm(src.slice(start, end + 1));
    entries.push({ id: sha(text).slice(0, 12), text });
  }
  const seen = new Map();
  for (const e of entries) seen.set(e.id, (seen.get(e.id) ?? 0) + 1);
  const duplicates = entries.filter((e) => seen.get(e.id) > 1).map((e) => e.text).filter((t, i, a) => a.indexOf(t) === i);
  return { entries, duplicates, unparsed };
}

/** 母體戳記：幾筆、雜湊（排序後的編號串起來） */
export function stampOf(src) {
  const { entries, unparsed } = registryOf(src);
  // 括號收不齊＝這支檔數不清楚：不給戳記（不能把數不清楚的母體當成一個版本，§5.13）
  if (unparsed.length) return null;
  return { n: entries.length, hash: sha(entries.map((e) => e.id).sort().join('\n')).slice(0, 16) };
}

/** 哪幾條帶 expect 的突變要複審：沒有戳記、或戳記跟現在的母體不一樣。readTest(測試名) → 原始碼或 null */
export function reviewNeeded(mutations, stamps, readTest) {
  const cur = new Map();
  const out = [];
  for (const m of mutations) {
    if (m.expect == null) continue;
    if (!cur.has(m.test)) { const s = readTest(m.test); cur.set(m.test, s == null ? 'missing' : (stampOf(s) ?? 'unparsed')); }
    const now = cur.get(m.test); const old = stamps?.[m.name];
    if (now === 'missing') out.push({ name: m.name, test: m.test, why: '測試檔讀不到' });
    else if (now === 'unparsed') out.push({ name: m.name, test: m.test, why: '登記表數不清楚（有斷言的括號收不齊），判斷不了母體有沒有變' });
    else if (!old) out.push({ name: m.name, test: m.test, why: '沒有戳記（還沒複審過）' });
    else if (old.test !== m.test || old.hash !== now.hash) out.push({ name: m.name, test: m.test, why: `斷言母體從 ${old.n} 筆變成 ${now.n} 筆${old.n === now.n ? '（筆數一樣、內容變了）' : ''}` });
  }
  return out;
}

export const readTestFrom = (root) => (t) => { const p = path.join(root, 'scripts', `${t}.mjs`); return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null; };
export function loadStamps(root = ROOT) {
  const p = path.join(root, REVIEW_FILE);
  if (!fs.existsSync(p)) return {};
  return JSON.parse(fs.readFileSync(p, 'utf8')).stamps ?? {};
}

/** 對照組（§5.3）：合成的測試原始碼，每一種各一個樣本 */
export function controls() {
  const bad = [];
  const base = "ok(a, 'A');\neq(b, 1, `B ${x}`);\neveryOf(list,\n  (r) => r.ok,\n  'C 跨行');\n// ok(z, '註解裡的不算');\nfunction ok(c, m) {}\nfoo.ok(q);\nconst probe = \"ok(1 === 1, 'a');\";\nconst t = `x ${ok(2)} eq(3) y`;\n";
  const r = registryOf(base);
  if (r.entries.length !== 4) bad.push(`基本樣本應該 4 筆（ok、eq、跨行 everyOf、樣板字串 \${} 裡真的呼叫的 ok；註解、函式定義、foo.ok、字串與樣板字面裡的不算），實際 ${r.entries.length}`);
  if (!r.entries.some((e) => e.text.includes("'C 跨行'"))) bad.push('跨行的呼叫要收到右括號（訊息在下一行）');
  if (registryOf(`${base}ok(a, 'A');\n`).duplicates.length !== 1) bad.push('同一個斷言寫兩次要列成重複');
  const s0 = stampOf(base); const s1 = stampOf(`${base}ok(n, 'D 新的');\n`);
  if (s0.hash === s1.hash || s1.n !== s0.n + 1) bad.push('多一個斷言，戳記要變、筆數要多 1');
  if (stampOf(`${base}ok(a, 'E 括號沒收齊';\n`) !== null) bad.push('有斷言的括號收不齊 → 不給戳記（數不清楚，不是一個版本）');
  const s2 = stampOf(base.replace("'A'", "'A 改了'"));
  if (s2.hash === s0.hash || s2.n !== s0.n) bad.push('筆數一樣、內容改了，戳記也要變');
  const muts = [{ name: 'X', test: 't', expect: 'A' }, { name: 'Y', test: 't', expect: 'C' }, { name: 'Z', test: 't' }];
  const read = (src) => () => src;
  const rv0 = reviewNeeded(muts, { X: { test: 't', ...s0 }, Y: { test: 't', ...s0 } }, read(base));
  if (rv0.length !== 0) bad.push(`戳記跟現在一樣 → 不必複審，實際 ${rv0.length} 條`);
  const rv1 = reviewNeeded(muts, { X: { test: 't', ...s0 }, Y: { test: 't', ...s0 } }, read(`${base}ok(n, 'D 新的');\n`));
  if (rv1.map((x) => x.name).join(',') !== 'X,Y') bad.push(`母體長大 → 帶 expect 的兩條都要複審、沒帶的不列，實際 ${rv1.map((x) => x.name).join(',')}`);
  const rv2 = reviewNeeded(muts, { X: { test: 't', ...s0 } }, read(base));
  if (rv2.map((x) => x.name).join(',') !== 'Y') bad.push('沒有戳記的要列出來');
  return bad;
}

function main() {
  const args = process.argv.slice(2);
  const bad = controls();
  if (bad.length) { console.log(`✗ 登記表的對照組不過（量法壞了）：${bad.join('｜')}`); return 1; }
  const muts = loadMutations(fs.readFileSync(path.join(ROOT, 'scripts/mutationtest.mjs'), 'utf8')) ?? [];
  const read = readTestFrom(ROOT);
  if (args[0] === '--stamp') {
    // --stamp <關鍵字>：名稱或測試名含關鍵字的、帶 expect 的突變，戳上現在的母體（＝複審過了）。--stamp --all：全部
    const key = args[1];
    if (!key) { console.log('✗ --stamp 要給關鍵字（或 --all）'); return 1; }
    const p = path.join(ROOT, REVIEW_FILE);
    const doc = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : { note: '每條帶 expect 的突變：寫（或複審）這條 expect 時，那支測試的斷言母體（筆數、雜湊）。由 node scripts/assertregistry.mjs --stamp 寫，不手改。2026-10-02 第一次全部戳上＝當時的母體，不代表逐條複審過。', stamps: {} };
    let n = 0;
    // 戳記＝「複審過了」：有歧義的（expect 在測試裡出現不只一處）不准戳，先修（2026-10-02：我自己就在有 1 條歧義時整批重戳過一次）
    const picked = muts.filter((m) => m.expect != null && (key === '--all' || m.name.includes(key) || m.test === key));
    const amb = picked.filter((m) => { const s = read(m.test); return s != null && classifyExpect(m.expect, s).kind === 'ambiguous'; });
    if (amb.length) { console.log(`✗ 有歧義的不戳（先修 expect 或測試訊息）：${amb.map((m) => `${m.name}（expect「${m.expect}」）`).join('、')}`); return 1; }
    for (const m of muts) {
      if (m.expect == null) continue;
      if (key !== '--all' && !m.name.includes(key) && m.test !== key) continue;
      const src = read(m.test); const st = src == null ? null : stampOf(src);
      if (!st) { console.log(`  沒戳：${m.name}（${src == null ? '測試檔讀不到' : '登記表數不清楚'}）`); continue; }
      doc.stamps[m.name] = { test: m.test, ...st }; n += 1;
    }
    for (const k of Object.keys(doc.stamps)) if (!muts.some((m) => m.name === k && m.expect != null)) delete doc.stamps[k];
    doc.stamps = Object.fromEntries(Object.entries(doc.stamps).sort(([a], [b]) => a.localeCompare(b)));
    fs.writeFileSync(p, `${JSON.stringify(doc, null, 1)}\n`);
    console.log(`戳了 ${n} 條（關鍵字「${key}」）；戳記檔共 ${Object.keys(doc.stamps).length} 條`);
    return 0;
  }
  // 預設：列出登記表的概況與要複審的
  const tests = [...new Set(muts.filter((m) => m.expect != null).map((m) => m.test))].sort();
  for (const t of tests) {
    const src = read(t); if (src == null) { console.log(`  ${t}：讀不到`); continue; }
    const r = registryOf(src);
    console.log(`  ${t}：斷言 ${r.entries.length} 筆、重複 ${r.duplicates.length} 組、收不齊 ${r.unparsed.length} 處`);
    for (const d of r.duplicates.slice(0, 5)) console.log(`    重複｜${d.slice(0, 140)}`);
  }
  const rv = reviewNeeded(muts, loadStamps(), read);
  console.log(`預期需要複審：${rv.length} 條（帶 expect ${muts.filter((m) => m.expect != null).length} 條）`);
  for (const x of rv.slice(0, 30)) console.log(`  ${x.test}｜${x.name}｜${x.why}`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main();

// assertaudit 的靜態掃描（2–5 段），抽成純函式（2026-09-24，v9 盤點的第 3 件）。
// 以前這幾個樣式寫在 assertaudit 裡：沒有對照組（實測：把「常數述詞」的樣式改壞，照樣全過），
// 而且 assertaudit 只在全面檢測才跑——兩次全面檢測之間，這幾段壞掉也沒有人會發現。
// 現在 assertaudit 與 doctest 用同一份：doctest 每版都拿它掃測試鏈那 26 支、附對照組。
// 每個函式：(原始碼, 檔名) → ['檔名:行號 片段', …]；沒有命中回 []。

const lineOf = (s, idx) => s.slice(0, idx).split('\n').length;

/** 2. 常數述詞：everyOf／noneOf 的述詞永遠回 true／false。 */
export function constPredHits(src, file = '') {
  const out = [];
  for (const m of src.matchAll(/(?:everyOf|noneOf)\([^;]*?=>\s*(?:true|false)\s*[,)]/g)) {
    out.push(`${file}:${lineOf(src, m.index)} ${m[0].replace(/\s+/g, ' ').slice(0, 70)}`);
  }
  return out;
}

/** 3. ok(true, …)：說明行混進斷言數（要用 note()）。 */
export function okTrueHits(src, file = '') {
  const out = [];
  for (const m of src.matchAll(/\bok\(\s*true\s*,/g)) out.push(`${file}:${lineOf(src, m.index)} ${m[0]}`);
  return out;
}

/** 4. eq(x, x)：左右是同一段程式碼，恆真。 */
export function eqSameHits(src, file = '') {
  const out = [];
  for (const m of src.matchAll(/\beq\(([^,]{3,60}),\s*([^,]{3,60}),/g)) {
    if (m[1].trim() === m[2].trim()) out.push(`${file}:${lineOf(src, m.index)} ${m[0].slice(0, 60)}`);
  }
  return out;
}

/**
 * 5. regex 跳脫壞掉：測試碼裡出現兩個反斜線接 s／d／w／b（而且前面不再有反斜線——否則那是
 * 「跳脫一個反斜線」後面剛好接普通字母，像字串字面值的 char class `[^'\\\n]`）。
 * 註解行不算；真的要在字串裡寫兩個反斜線就加 audit-allow。
 */
export function doubledEscapeHits(src, file = '') {
  const out = [];
  const lines = src.split('\n');
  for (const m of src.matchAll(/(?<!\\)\\\\[sdwbSDWB]/g)) {
    const line = lineOf(src, m.index);
    const ctx = lines[line - 1].trim().slice(0, 80);
    if (/audit-allow/.test(ctx) || ctx.startsWith('//') || ctx.startsWith('*') || ctx.startsWith('/*')) continue;
    out.push(`${file}:${line} ${ctx}`);
  }
  return out;
}

export const STATIC_RULES = { constPredHits, okTrueHits, eqSameHits, doubledEscapeHits };

// docs/待確認_加工品葷素.md 的「你的決定」⇄ data/foodtags.json（2026-10-01，A 方案）。
// 標示由資料驅動：Yolin 在表上填了決定，開發 Session 轉進 foodtags.json（checked／tags），食譜頁的「未確認」就自動消失。
// 這裡核對兩邊：表上填了、資料沒轉進去 → doctest 紅（不靠人記得轉）。空白與「不確定」不要求資料有任何東西。
// 純函式，doctest 用合成樣本驗每一個分支。

export const DECISION_FILE = 'docs/待確認_加工品葷素.md';
const VEG_TAGS = ['egg', 'dairy', 'allium'];
const CONTAINS = { 含蛋: 'egg', 含奶: 'dairy', 含五辛: 'allium' };

/** 讀表：回 [{ name, id, decision }]。找不到表頭或欄位 → 丟錯（不當成「沒有任何決定」）。 */
export function parseDecisionTable(md) {
  const lines = String(md).split('\n');
  const h = lines.findIndex((l) => l.startsWith('| 加工品 |'));
  if (h < 0) throw new Error(`${DECISION_FILE} 找不到表頭（| 加工品 | …）`);
  const cols = lines[h].split('|').slice(1, -1).map((c) => c.trim());
  const iName = cols.indexOf('加工品'); const iId = cols.indexOf('編號'); const iDec = cols.indexOf('你的決定');
  if (iId < 0 || iDec < 0) throw new Error(`${DECISION_FILE} 的表頭少了「編號」或「你的決定」`);
  const rows = [];
  for (const l of lines.slice(h + 2)) {
    if (!l.startsWith('|')) break;
    const c = l.split('|').slice(1, -1).map((x) => x.trim());
    rows.push({ name: c[iName], id: c[iId], decision: c[iDec] ?? '' });
  }
  return rows;
}

/** 一格決定拆成詞；回 { tokens, bad: [看不懂的詞] } */
export function decisionTokens(decision) {
  const tokens = String(decision ?? '').split(/[、,，\s]+/).map((t) => t.trim()).filter(Boolean);
  const bad = tokens.filter((t) => !(t === '素' || t === '葷' || t === '不確定' || t in CONTAINS));
  return { tokens, bad };
}

/** 表上的決定，資料有沒有照著寫進去：回問題字串陣列，空的＝一致 */
export function decisionProblems(rows, foodtags) {
  const tags = foodtags?.tags ?? {}; const checked = foodtags?.checked ?? {};
  const has = (t, id) => Array.isArray(tags[t]) && tags[t].includes(id);
  const out = [];
  for (const r of rows) {
    const { tokens, bad } = decisionTokens(r.decision);
    if (bad.length) { out.push(`${r.name}（${r.id}）：看不懂「${bad.join('、')}」`); continue; }
    for (const t of tokens) {
      if (t === '素') {
        const miss = VEG_TAGS.filter((x) => !(checked[r.id] ?? []).includes(x));
        if (miss.length) out.push(`${r.name}（${r.id}）：表上填「素」，checked 少了 ${miss.join('、')}`);
        const wrong = ['meat', 'seafood', ...VEG_TAGS].filter((x) => has(x, r.id));
        if (wrong.length) out.push(`${r.name}（${r.id}）：表上填「素」，tags 卻標了 ${wrong.join('、')}`);
      } else if (t in CONTAINS) {
        if (!has(CONTAINS[t], r.id)) out.push(`${r.name}（${r.id}）：表上填「${t}」，tags.${CONTAINS[t]} 沒有它`);
      } else if (t === '葷') {
        if (!has('meat', r.id) && !has('seafood', r.id)) out.push(`${r.name}（${r.id}）：表上填「葷」，tags 的 meat、seafood 都沒有它`);
      }
    }
  }
  return out;
}

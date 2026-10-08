// 共用慣例副本要跟主檔一致（2026-10-08，Dispatch：副本過期時，過期的規則和現行的規則在閱讀時長得一樣——
// 都叫「共用慣例」、都讀得通，沒有任何地方會告訴你手上那份過期了；10-08 這個 Session 照著 v11.4 的副本工作一整天，
// 主檔早就是 v11.6，違反了兩條自己不知道有的規則）。doctest 每次都跑。
//
// 主檔：統籌工作區（統籌 Session 的 repo）的 CONVENTIONS.md——**由 Dispatch 於 2026-10-08 這一輪確認**：統籌工作區的
// CONVENTIONS.md 就是主檔，這是專案既定的安排（原本是我從內容推斷的：帶變更紀錄、最後 commit 10-02；現在是已確認，不是推斷）。
// 路徑用相對於本 repo 根目錄的寫法登記在這裡（不寫本機絕對路徑：repo 是公開的）。搬家了就改這一行。
// 換一台沒有統籌工作區的機器，這道檢查會紅（讀不到主檔）——照設計：靜默跳過的版本比對等於沒有版本比對，紅了至少會有人問為什麼。
// 判定：讀不到主檔＝紅（講明「讀不到主檔」，不當成通過）；版本行不同＝紅；版本行相同、全文不同＝紅（主檔改了內容卻沒改版本）。
import fs from 'node:fs';
import path from 'node:path';

export const MASTER_REL = '../../Fable_Planner/CONVENTIONS.md';
export const COPY_REL = 'docs/CONVENTIONS.md';

/** 第一行的版本標記：<!-- CONVENTIONS vX 日期 -->；不是這個樣子就回 null */
export function versionLine(text) {
  const first = String(text ?? '').replace(/^﻿/, '').split(/\r?\n/)[0];
  return /^<!-- CONVENTIONS v[\d.]+ \d{4}-\d{2}-\d{2} -->$/.test(first) ? first : null;
}

/** 比對副本與主檔的內容（純函式）：{ ok, why } */
export function compareConv(copyText, masterText) {
  if (masterText == null) return { ok: false, why: '讀不到主檔' };
  if (copyText == null) return { ok: false, why: '讀不到副本' };
  const cv = versionLine(copyText); const mv = versionLine(masterText);
  if (!mv) return { ok: false, why: '主檔第一行不是版本標記' };
  if (!cv) return { ok: false, why: '副本第一行不是版本標記' };
  if (cv !== mv) return { ok: false, why: `版本不同：副本 ${cv}、主檔 ${mv}——副本過期，照主檔更新（照統籌者的工單）` };
  const norm = (t) => String(t).replace(/^﻿/, '').replace(/\r\n/g, '\n');
  if (norm(copyText) !== norm(masterText)) return { ok: false, why: `版本相同（${cv}）但全文不同——主檔改了內容卻沒改版本，或副本被改過` };
  return { ok: true, why: `一致（${cv}）` };
}

/**
 * 副本和主檔是不是同一個實體檔（2026-10-08，抄 TripQuest 的做法：擋在檢查程式裡，不只在測試裡比路徑字串）。
 * 同一個實體檔時兩邊內容必然永遠相同，比對永遠是綠的——而路徑字串可以看起來完全不同（硬連結、符號連結、接合點）。
 * 兩層、各報不同的理由：一、實際路徑（realpath，解開符號連結與接合點）相同 → 指到同一個路徑；
 * 二、路徑不同、但磁碟與檔案編號相同 → 硬連結，是同一個實體檔。讀不到的不在這裡判（交給「讀不到主檔／副本」）。
 */
export function sameFile(a, b) {
  let ra; let rb;
  try { ra = fs.realpathSync.native(a); rb = fs.realpathSync.native(b); } catch { return null; }
  if (ra.toLowerCase() === rb.toLowerCase()) return '指到同一個路徑（解開連結之後）';
  try {
    const sa = fs.statSync(ra, { bigint: true }); const sb = fs.statSync(rb, { bigint: true });
    if (sa.dev === sb.dev && sa.ino === sb.ino && sa.ino !== 0n) return '是同一個實體檔（硬連結：磁碟與檔案編號相同）';
  } catch { return null; }
  return null;
}

/** 從 repo 根目錄讀兩份來比 */
export function convCheck(root, { masterRel = MASTER_REL, copyRel = COPY_REL } = {}) {
  const ca = path.resolve(root, copyRel); const ma = path.resolve(root, masterRel);
  const same = sameFile(ca, ma);
  if (same) return { ok: false, why: `副本與主檔${same}——內容必然永遠相同，比對沒有意義` };
  const read = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };
  return compareConv(read(ca), read(ma));
}

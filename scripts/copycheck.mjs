// 暫存複本的讀回確認（共用慣例 v11.4 §5.20；2026-10-02 MealMate 撞出來的：clone 拿到的是已 commit 的版本，
// 突變執行器改的卻是工作區——守 WS2–WS4 的三條突變從頭到尾測的是原版）。
// 複本必須含有這次要測的改動，而且要讀回確認：讀不到、內容不同，就判「情境未成立」，不是紅、也不是綠。
//
// **要確認的清單由這裡自己從來源目錄列出來，不用「當初複製了哪些」**：複製時漏掉一支，若確認也照著同一份清單，
// 漏掉的那一支永遠對得上（拿自己跟自己比）。
import fs from 'node:fs';
import path from 'node:path';

/**
 * 來源目錄 srcDir 底下名稱符合 pattern 的每一支檔，在 destDir 底下都要存在、而且逐位元組相同。
 * 回 { checked: 比了幾支, problems: ['檔名：缺少'｜'檔名：內容不同'] }。來源目錄是空的也算問題（什麼都沒比）。
 */
export function verifyCopies(srcDir, destDir, pattern = /\.m?js$/) {
  const names = fs.readdirSync(srcDir).filter((f) => pattern.test(f) && fs.statSync(path.join(srcDir, f)).isFile());
  const problems = [];
  if (!names.length) problems.push(`${srcDir}：來源目錄裡一支符合的檔都沒有（什麼都沒比）`);
  for (const f of names) {
    const d = path.join(destDir, f);
    if (!fs.existsSync(d)) { problems.push(`${f}：複本裡缺少`); continue; }
    if (!fs.readFileSync(d).equals(fs.readFileSync(path.join(srcDir, f)))) problems.push(`${f}：複本的內容跟工作區不同`);
  }
  return { checked: names.length, problems };
}

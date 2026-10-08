// 「名字帶建立者」的兩個純函式（2026-10-08，從 worktreesweep.mjs 拆出來）：只組字串、只讀字串，不碰檔案系統、不開程序。
// 為什麼拆：browserlib 原本為了 wtPrefix 去 import worktreesweep.mjs——收拾程式裡讀檔、刪檔的路徑不是寫死的，挑選器
// （depgraph）判斷不出範圍、退回「整個 repo」，瀏覽器測試那一類（131 條突變）整個被算成整個 repo（方向安全、但精確度掉光）。
// 這支沒有任何動態路徑，誰 import 它都不會讓範圍變大。
import os from 'node:os';
import path from 'node:path';

/** 新的暫存項目名字的前綴（放在 os.tmpdir() 底下，由呼叫端 mkdtemp）：mm-<kind>-<pid>-<毫秒>- */
export const wtPrefix = (kind) => path.join(os.tmpdir(), `mm-${kind}-${process.pid}-${Date.now()}-`);

/** 從路徑讀出建立者：{ pid, at } 或 null（舊格式） */
export function ownerOf(p) {
  for (const seg of String(p).split(/[\\/]/).reverse()) {
    const m = /^mm-[a-z]+-(\d+)-(\d{13})-/.exec(seg);
    if (m) return { pid: Number(m[1]), at: Number(m[2]) };
  }
  return null;
}

// 崩潰行（2026-10-27，(i)；設計稿 .logs/2026-10-25-design-i.md）：測試中途丟出沒接住的例外時，tap 印的那一行的固定開頭。
// 印的一方（tap.mjs）與認的一方（runkind.mjs、mutationtest.mjs）都從這裡取，不各寫一份——改了一邊、漏了另一邊，
// 認的那一方就變成在找一個不存在的字串（遊戲那條線 10-25 A7 撞過同一種事）。
// 刻意以 ✗ 開頭：舊的讀法（只認 ✗ 開頭的行）看到它會當成「有東西紅了」——所以每一個讀 ✗ 的地方都要先把它拿掉（見 isCrashLine）。
export const CRASH_MARK = '✗ 中途丟例外：';

/** 這一行是不是崩潰行（去掉行首空白後以 CRASH_MARK 開頭；不在整行裡找子字串，共用慣例 §5.20） */
export function isCrashLine(l) {
  return String(l ?? '').trimStart().startsWith(CRASH_MARK);
}

/**
 * 崩潰行的形狀可不可信（判準表第五列）：tap 的處理器只印一次、印完就結束，所以可信的形狀只有一種——
 * stdout 裡**剛好一行**崩潰行，而且它是**最後一行有內容的**。兩行以上、或後面還有輸出，就是有別的東西在寫，不解讀。
 * 唯一登記過、准許排在後面的寫入者：jobrun.mjs 在測試結束之後印的「JOB-SUM …」結算（執行器經 Job 跑測試時一定有它）。
 * 登記制——只有這一種開頭不算「後面還有輸出」，別的都算。
 */
export const TRAILER_PREFIXES = ['JOB-SUM '];
export function crashShape(stdout) {
  const lines = String(stdout ?? '').split(/\r?\n/).filter((l) => l.trim() !== '' && !TRAILER_PREFIXES.some((p) => l.trimStart().startsWith(p)));
  const at = lines.map((l, i) => (isCrashLine(l) ? i : -1)).filter((i) => i >= 0);
  return { count: at.length, wellFormed: at.length === 1 && at[0] === lines.length - 1 };
}

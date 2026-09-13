// 文案禁用詞的判準（copytest 掃原始碼字串、redlinetest 掃畫面上渲染出來的字，兩邊共用同一份）。
//
// 這裡只放清單與判斷，沒有斷言 —— 被 import 時不可以有副作用。
// 清單刻意不收「處方」「醫囑」這種**否定句裡會出現**的詞：
// 「不是營養處方」「不能取代醫囑」是這個 App 必須講的話，收進去會把正確的文案判成違規。

export const FORBIDDEN = [
  '治療', '療效', '控制血糖', '降血糖', '降血壓', '改善腎功能',
  '適合糖尿病', '糖尿病專用', '腎臟病專用', '減重', '瘦身', '排毒', '保證',
  '建議攝取', '應該吃', '取代醫囑',
];

export function forbiddenIn(text) {
  const s = String(text ?? '');
  return FORBIDDEN.filter((w) => s.includes(w));
}

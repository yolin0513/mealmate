// 這一版的版本號。**單一來源。**
//
// 同一個字串必須同時出現在三個地方，而且完全一致：
//   1. 這裡（APP_VERSION）—— 執行期的程式碼看得到的版本
//   2. sw.js 的 VERSION —— 決定快取名稱與換版時機
//   3. index.html 裡 app.js 的 ?v= 參數 —— 決定瀏覽器的 HTTP 快取鍵
//
// GitHub Pages 對每個檔案送 Cache-Control: max-age=600 且不 revalidate，瀏覽器的 HTTP
// 快取逐檔計時；Service Worker 還沒接手的空窗期，一個十分鐘前快取的 app.js 可能配上
// 剛抓下來的 view（StockDiary 實際踩過：按按鈕跳回首頁）。把版本號放進網址，
// 舊版與新版就是不同的快取鍵，混不起來。
//
// 改版本號用 `npm run bump -- mealmate-v0.1.1`；shelltest 會斷言三者一致。

export const APP_VERSION = 'mealmate-v0.29.0';

/** 給動態 import 與資源網址用的版本參數。 */
export const V = `?v=${APP_VERSION}`;

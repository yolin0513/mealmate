/* 開機看門狗。**刻意是一支普通 script（不是 module）、也刻意不 import 任何東西。**
 *
 * 為什麼要有它：`index.html` 載入的是一整張 module 圖（app.js → router／store／db／ui／shell／
 * planner… 二十幾個檔）。那張圖裡**任何一個檔案拿不到**，整張圖就不會執行 —— 畫面上會是
 * 「只剩最上面的標題列，下面整片空白」：連 `renderLoading()` 的轉圈圈都沒有，因為 app.js 根本沒跑到。
 * 使用者唯一的出路是把 App 從多工列滑掉重開（Yolin 2026-09-17 回報的就是這個畫面）。
 *
 * 最容易踩到的時機是**換版**：剛按下「更新」、Service Worker 正在換手，而手機的網路又不穩。
 *
 * 這支檔案只有幾十行、沒有相依，所以它幾乎一定載得到。它做的事只有一件：
 * 開機超過 BOOT_TIMEOUT 還沒有人把 `<html data-booted="1">` 標起來，就把一段看得懂的說明畫上去，
 * 並給兩顆按鈕（重新載入／清掉快取再載入）。**它不會蓋掉正常開機的畫面** —— 只在畫面還是空的時候動手。
 */
(function bootGuard() {
  var BOOT_TIMEOUT = 12000;

  function stillBlank() {
    var view = document.getElementById('view');
    if (!view) return false;
    if (document.documentElement.dataset.booted === '1') return false;
    // 轉圈圈（renderLoading）也算「還沒好」：app.js 跑起來了但卡在載資料，同樣需要一條出路。
    var text = (view.textContent || '').trim();
    return text.length === 0 || !!view.querySelector('.spinner');
  }

  function button(label, onClick) {
    var b = document.createElement('button');
    b.className = 'btn';
    b.type = 'button';
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  }

  function show() {
    if (!stillBlank()) return;
    var view = document.getElementById('view');
    var card = document.createElement('section');
    card.className = 'card';
    card.setAttribute('data-card', 'bootStuck');

    var h = document.createElement('h2');
    h.className = 'card-title';
    h.textContent = '載入卡住了';
    card.appendChild(h);

    var p1 = document.createElement('p');
    p1.textContent = '這個畫面應該幾秒就好。卡在這裡通常是剛更新完、程式檔案還沒抓齊。';
    card.appendChild(p1);

    var again = button('重新載入', function () { location.reload(); });
    again.classList.add('btn-primary');
    again.setAttribute('data-action', 'bootRetry');
    card.appendChild(again);

    var hard = button('清掉快取再載入', function () {
      hard.disabled = true;
      hard.textContent = '處理中…';
      var done = function () { location.replace('./?fresh=' + Date.now() + '#/'); };
      try {
        var jobs = [];
        if (window.caches && caches.keys) {
          jobs.push(caches.keys().then(function (keys) {
            return Promise.all(keys.map(function (k) { return caches.delete(k); }));
          }));
        }
        if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
          jobs.push(navigator.serviceWorker.getRegistrations().then(function (rs) {
            return Promise.all(rs.map(function (r) { return r.unregister(); }));
          }));
        }
        Promise.all(jobs).then(done, done);
        setTimeout(done, 4000);
      } catch (e) { done(); }
    });
    hard.setAttribute('data-action', 'bootHardReset');
    card.appendChild(hard);

    var p2 = document.createElement('p');
    p2.className = 'muted sm';
    p2.textContent = '兩顆都試過還是一樣的話：把 App 完全關掉（iPhone 從多工畫面上滑掉）再開一次。你存的資料不會因為這樣不見。';
    card.appendChild(p2);

    while (view.firstChild) view.removeChild(view.firstChild);
    view.appendChild(card);
  }

  setTimeout(show, BOOT_TIMEOUT);
  // 整張 module 圖沒載成功時，瀏覽器會在 window 上丟一個 error（例如 404 的 script）。
  // 不必等滿 12 秒，知道壞了就直接講。
  window.addEventListener('error', function (e) {
    if (!e || !e.target || e.target === window) return;
    var tag = e.target.tagName;
    if (tag !== 'SCRIPT' && tag !== 'LINK') return;
    setTimeout(show, 1200);
  }, true);
}());

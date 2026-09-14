/* MealMate Service Worker
 * - SHELL（HTML/CSS/JS/data JSON/圖示）：install 時整組預快取，之後只從本版快取拿（cache-first）
 * - 導覽請求：network-first，離線時回退 index.html
 * - 這個 App 沒有跨網域請求；就算有也一律不快取
 *
 * 每次改動任何 SHELL 檔案都要 bump VERSION，否則使用者拿到的還是舊程式。
 */
const VERSION = 'mealmate-v0.16.0';
const SHELL = `${VERSION}-shell`;

const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './js/app.js',
  './js/router.js',
  './js/store.js',
  './js/db.js',
  './js/ui.js',
  './js/shell.js',
  './js/prefs.js',
  './js/version.js',
  './js/foods.js',
  './js/units.js',
  './js/recipeschema.js',
  './js/edu.js',
  './js/members.js',
  './js/nutrition.js',
  './js/backup.js',
  './js/planner.js',
  './js/shopping.js',
  './js/timeline.js',
  './js/views/welcome.js',
  './js/views/week.js',
  './js/views/weekops.js',
  './js/views/shopping.js',
  './js/views/today.js',
  './js/views/recipes.js',
  './js/views/recipe.js',
  './js/views/recipeedit.js',
  './js/views/family.js',
  './js/views/member.js',
  './data/foods.json',
  './data/aliases.json',
  './data/units.json',
  './data/foodtags.json',
  './data/recipes.json',
  './data/edu.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

const SHELL_SET = new Set(SHELL_ASSETS.map((u) => new URL(u, self.location.href).pathname));

self.addEventListener('install', (e) => {
  e.waitUntil(
    // cache:'reload' 一定要加：GitHub Pages 對每個檔案送 Cache-Control: max-age=600，
    // 普通的 addAll 會走瀏覽器 HTTP 快取，新版 SW 有機會把舊的 JS 存進新快取。
    caches.open(SHELL).then((c) => c.addAll(SHELL_ASSETS.map((u) => new Request(u, { cache: 'reload' }))))
    // 刻意不自動 skipWaiting：由畫面決定何時換版。
  );
});

self.addEventListener('message', (e) => {
  const d = e.data;
  if (d === 'SKIP_WAITING' || (d && d.type === 'SKIP_WAITING')) self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // 跨網域：直接走網路，永遠不快取（這個 App 本來就不該有這種請求）。
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    e.respondWith(fetch(request).catch(() => caches.match('./index.html')));
    return;
  }

  // SHELL：只從「這個版本的快取」拿，不背景覆寫。
  // ignoreSearch：網址上的 ?v=<版本> 只是 HTTP 快取鍵，對 SW 來說同一個檔案就是同一個檔案。
  if (SHELL_SET.has(url.pathname)) {
    e.respondWith(caches.match(request, { ignoreSearch: true }).then((hit) => hit || fetch(request)));
    return;
  }

  e.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request).then((res) => {
        if (res && res.ok) {
          const clone = res.clone();
          caches.open(SHELL).then((c) => c.put(request, clone));
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});

/*
 * Service worker：讓「加入主畫面」之後離線也開得起來。
 *
 * 兩種策略，分開用是刻意的：
 * - HTML 文件走 network-first。用 cache-first 的話，部署新版之後玩家會永遠停在舊版，
 *   而且畫面看起來完全正常——這是 SW 最經典也最難查的坑。
 * - 其他同源資產走 stale-while-revalidate。Vite 的檔名帶內容雜湊，改版就是新檔名，
 *   先拿快取再背景更新不會拿到過期內容。
 *
 * 版本號改了就會清掉舊快取。資產檔名有雜湊，平常不需要手動改。
 */
const VERSION = 'lpg-v1';
const SCOPE = new URL(self.registration.scope).pathname;

/*
 * `ignoreVary` 是必要的，不是保險。
 * GitHub Pages（與 vite preview）對靜態資產回 `Vary: Origin`；快取是用 URL 字串寫進去的，
 * 那個 Request 沒有 Origin 標頭，但瀏覽器抓 module script 時的 Request **有**——
 * Vary 比對不過就整個 miss，於是離線時 JS／CSS 全部 ERR_FAILED，而快取裡明明有。
 * 實測過：`caches.match(url)` 命中、`caches.match(實際的 request)` 不命中。
 */
const MATCH = { ignoreVary: true };

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION).then((c) => c.addAll([SCOPE, `${SCOPE}manifest.webmanifest`])).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function isDocument(request) {
  return request.mode === 'navigate' || request.destination === 'document';
}

/*
 * 第一次載入時 SW 還沒接管，那一輪的 JS／CSS／GLB 是繞過 SW 抓的，不會進快取——
 * 只靠 fetch handler 的話，玩家「加入主畫面後第一次離線開」會是白畫面。
 * 所以頁面載完會把自己實際用到的資源清單丟過來，這裡補進快取。
 * 用清單而不是在 install 寫死檔名：Vite 的檔名帶內容雜湊，寫死就得多一個建置步驟去產。
 */
self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || data.type !== 'warm' || !Array.isArray(data.urls)) return;
  event.waitUntil(
    caches.open(VERSION).then((cache) =>
      Promise.all(
        data.urls.map((u) =>
          cache.match(u).then((hit) => (hit ? undefined : cache.add(u).catch(() => undefined))),
        ),
      ),
    ),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (isDocument(request)) {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          void caches.open(VERSION).then((c) => c.put(SCOPE, copy));
          return res;
        })
        // 離線：拿上一次存的首頁
        .catch(() => caches.match(SCOPE, MATCH).then((hit) => hit ?? Response.error())),
    );
    return;
  }

  event.respondWith(
    caches.match(request, MATCH).then((hit) => {
      const network = fetch(request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            void caches.open(VERSION).then((c) => c.put(request, copy));
          }
          return res;
        })
        .catch(() => hit ?? Response.error());
      return hit ?? network;
    }),
  );
});

// sw.js
const CACHE = "expense-pwa-v3";

const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./config.js",
  "./src/app.js",
  "./src/ui.js",
  "./src/db.js",
  "./src/util.js",
  "./src/drive.js",
  "./src/drive_sync.js",
  "./src/merge.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(k => (k !== CACHE ? caches.delete(k) : null)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Only handle same-origin
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((resp) => {
        // Cache new GET requests
        if (req.method === "GET" && resp && resp.status === 200) {
          const copy = resp.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return resp;
      });
    })
  );
});

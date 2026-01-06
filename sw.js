// Very small app-shell cache for offline opening
// Bump this when you deploy changes so existing installs pull the new UI.
const CACHE = "expense-pwa-v2";
const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./manifest.webmanifest",
  "./config.js",
  "./src/app.js",
  "./src/db.js",
  "./src/util.js",
  "./src/crypto.js",
  "./src/drive.js",
  "./src/export_import.js",
  "./src/merge.js",
  "./src/ui.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  event.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) return cached;
    try {
      const fresh = await fetch(req);
      return fresh;
    } catch {
      // fallback to app shell
      return caches.match("./");
    }
  })());
});

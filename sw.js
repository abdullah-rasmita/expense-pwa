// sw.js
// Offline cache with version bump.
// IMPORTANT: change CACHE when you deploy new JS, otherwise old JS stays forever.
const CACHE = "expense-pwa-v5";

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
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(ASSETS);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  const isCode =
    url.pathname.includes("/src/") ||
    url.pathname.endsWith(".js") ||
    url.pathname.endsWith(".css") ||
    url.pathname.endsWith(".webmanifest");

  // For JS/CSS: NETWORK FIRST (so updates actually update), fallback to cache.
  if (isCode) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req, { cache: "no-store" });
        const cache = await caches.open(CACHE);
        cache.put(req, fresh.clone());
        return fresh;
      } catch {
        const cached = await caches.match(req);
        if (cached) return cached;
        return fetch(req);
      }
    })());
    return;
  }

  // For everything else: CACHE FIRST
  event.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) return cached;
    try {
      const fresh = await fetch(req);
      return fresh;
    } catch {
      return caches.match("./");
    }
  })());
});

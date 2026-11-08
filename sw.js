/*
 * Service worker: makes the app load with no internet connection.
 * Strategy: precache the app shell; serve cache-first, refresh the cache in the background.
 * Bump CACHE when shipping changes so old files are dropped.
 * NOTE: user data is NOT here; it lives in localStorage and is never touched by this file.
 */
const CACHE = 'work-log-v1.0.0';
const ASSETS = [
  './',
  'index.html',
  'css/styles.css',
  'js/calc.js',
  'js/i18n.js',
  'js/xlsx.js',
  'js/report.js',
  'js/storage.js',
  'js/app.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});

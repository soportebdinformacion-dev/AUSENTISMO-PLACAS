const CACHE_NAME = 'huarmey-pwa-v5';
const STATIC_ASSETS = ['./', './index.html', './styles.css', './app.js', './db.js', './manifest.json', './logo.png', './icon-192.png', './icon-512.png', './favicon.png',
  'https://cdn.jsdelivr.net/npm/dexie@3.2.4/dist/dexie.min.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(STATIC_ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.hostname.includes('script.google.com') || url.hostname.includes('googleusercontent.com')) return; // la API va directo a la red
  e.respondWith(
    caches.match(req).then(cached => {
      const net = fetch(req).then(res => {
        if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(CACHE_NAME).then(c => c.put(req, copy)); }
        return res;
      }).catch(() => cached);
      return cached || net;
    })
  );
});

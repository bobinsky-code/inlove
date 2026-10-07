/* Кэш нужен, чтобы игра открывалась с домашнего экрана и без сети.
   Сначала всегда идём в сеть: так у обоих владельцев свежая версия, а
   кэш остаётся запасным вариантом на случай обрыва связи. */
const CACHE = 'inlove-1';
const SHELL = ['./', './index.html', './app.html', './pet.html', './fb.js', './manifest.webmanifest',
  './icon.svg', './icon-64.png', './icon-192.png', './icon-512.png', './icon-mask.png'];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const r = e.request;
  if (r.method !== 'GET') return;
  if (new URL(r.url).origin !== location.origin) return;      /* firebase и прочее мимо кэша */
  e.respondWith(fetch(r).then((resp) => {
    if (resp && resp.ok && resp.type === 'basic') {
      const copy = resp.clone();
      caches.open(CACHE).then((c) => c.put(r, copy)).catch(() => {});
    }
    return resp;
  }).catch(() => caches.match(r).then((m) => m || caches.match('./index.html'))));
});

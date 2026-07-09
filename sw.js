self.addEventListener('install', e => {});
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => e.respondWith(fetch(e.request).catch(() => caches.match(e.request))));
self.addEventListener('message', e => { if (e.data === 'SKIP_WAITING') self.skipWaiting(); });

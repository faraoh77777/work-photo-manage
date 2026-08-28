// 이 파일 내용이 바뀌어야 브라우저가 새 버전을 감지해 업데이트 배너를 띄운다.
// index.html/admin.html 등을 배포할 때마다 아래 버전 문자열을 함께 올려줄 것.
const SW_VERSION = '2026-08-28-3';
const CACHE_NAME = 'wp-shell-' + SW_VERSION;

// 현장에서 신호가 완전히 끊긴 상태로 앱을 "새로" 열어도 흰 화면 대신 마지막으로
// 받아둔 화면이라도 뜨도록, 핵심 화면들을 설치 시점에 미리 캐시해둔다.
// (예전엔 이 목록이 비어있어서 caches.match가 항상 빈손이었음 — 2026-08-23 수정)
const PRECACHE_URLS = [
  './',
  './index.html',
  './login.html',
  './admin.html',
  './site-setup.html',
  './privacy.html',
  './gallery/index.html',
  './Work%20photo_icon/manifest.json',
  './Work%20photo_icon/icon-192.png',
  './Work%20photo_icon/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      // 하나가 실패해도(오프라인 배포 직후 등) 나머지는 캐시되도록 개별 처리
      Promise.all(PRECACHE_URLS.map(url => cache.add(url).catch(err => console.warn('[sw] precache 실패', url, err))))
    )
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    Promise.all([
      // 이전 버전 캐시 정리
      caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))),
      self.clients.claim(),
    ])
  );
});

// 온라인일 땐 항상 최신 응답을 쓰고(update-banner가 새 버전을 감지해야 하므로 no-store 유지),
// 성공한 응답은 오프라인 대비용으로 캐시에 갱신해둔다. 네트워크가 아예 안 되면 그때만 캐시로 폴백.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;

  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request, { cache: 'no-store' })
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(e.request).then(cached => cached || caches.match('./index.html')))
    );
    return;
  }

  e.respondWith(
    fetch(e.request)
      .then(res => {
        // opaque(cross-origin) 응답도 오프라인 폴백용으로는 그대로 캐시해둔다.
        if (res && (res.ok || res.type === 'opaque')) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});

self.addEventListener('message', e => { if (e.data === 'SKIP_WAITING') self.skipWaiting(); });

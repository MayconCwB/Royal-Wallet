const CACHE_NAME = 'royal-wallet-shell-v1';
const APP_URL = './index.html';

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll([APP_URL, './']))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  // Firebase/API requests devem ir sempre para a rede.
  if (req.url.includes('googleapis.com') || req.url.includes('firestore.googleapis.com')) return;

  // Navegação: tenta a rede e cai para o HTML em cache.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then(resp => {
        const copy = resp.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(APP_URL, copy));
        return resp;
      }).catch(() => caches.match(APP_URL))
    );
    return;
  }

  // Recursos do app: cache primeiro, rede como atualização.
  event.respondWith(
    caches.match(req).then(cached => {
      const network = fetch(req).then(resp => {
        if (resp.ok && new URL(req.url).origin === self.location.origin) {
          const copy = resp.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, copy));
        }
        return resp;
      }).catch(() => cached);
      return cached || network;
    })
  );
});

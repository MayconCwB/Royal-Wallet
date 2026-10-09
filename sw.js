const CACHE_NAME = 'royal-wallet-shell-v5';
const APP_URL = './index.html';

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll([APP_URL, './', './royal-wallet-features.js']))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k.startsWith('royal-wallet-shell-') && k !== CACHE_NAME).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  // Firebase/API requests devem ir sempre para a rede.
  if (req.url.includes('googleapis.com') || req.url.includes('firestore.googleapis.com')) return;

  // Uma rede conectada sem internet não pode bloquear a abertura da cópia local.
  if (req.mode === 'navigate') {
    const network = fetch(req).then(async resp => {
        if (resp.ok) {
          const copy = resp.clone();
          await caches.open(CACHE_NAME).then(cache => cache.put(APP_URL, copy));
          return resp;
        }
        return (await caches.match(APP_URL)) || resp;
      }).catch(() => caches.match(APP_URL));
    event.waitUntil(network.then(() => {}));
    event.respondWith((async () => {
      let timer;
      try {
        const early = await Promise.race([
          network,
          new Promise(resolve => { timer = setTimeout(() => resolve(null), 2000); })
        ]);
        return early || (await caches.match(APP_URL)) || (await network) ||
          new Response('Abra o Royal Wallet uma vez com internet para preparar o acesso offline.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      } finally { clearTimeout(timer); }
    })());
    return;
  }

  // Recursos do app: cache primeiro, rede como atualização.
  event.respondWith(
    caches.match(req).then(cached => {
      const network = fetch(req).then(resp => {
        if (resp.ok && new URL(req.url).origin === self.location.origin) {
          const copy = resp.clone();
          event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.put(req, copy)));
        }
        return resp;
      }).catch(() => cached);
      return cached || network;
    })
  );
});

const CACHE_NAME = 'royal-wallet-shell-v14';
const APP_URL = './index.html';

self.addEventListener('install', event => {
  event.waitUntil(
    fetch('./app-assets.json', { cache: 'no-store' }).then(response => {
      if (!response.ok) throw Error('Lista de recursos offline indisponível.');
      return response.json();
    }).then(files => caches.open(CACHE_NAME).then(cache => cache.addAll(
      ['./', './app-assets.json', ...files.filter(file => file !== 'sw.js').map(file => './' + file)]
        .map(url => new Request(url, { cache: 'reload' }))
    )))
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
    event.respondWith((async () => {
      // HTML e scripts pertencem ao mesmo pacote instalado. Não substitui só o HTML.
      const cache = await caches.open(CACHE_NAME), cached = await cache.match(APP_URL);
      if (cached) return cached;
      const network = fetch(req).catch(() => null);
      let timer;
      try {
        const early = await Promise.race([
          network,
          new Promise(resolve => { timer = setTimeout(() => resolve(null), 2000); })
        ]);
        return early ||
          new Response('Abra o Royal Wallet uma vez com internet para preparar o acesso offline.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      } finally { clearTimeout(timer); }
    })());
    return;
  }

  // Uma atualização instala outro pacote completo; não mistura arquivos em segundo plano.
  event.respondWith(caches.open(CACHE_NAME).then(async cache => (await cache.match(req)) || fetch(req)));
});

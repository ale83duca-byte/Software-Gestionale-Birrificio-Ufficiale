// Service Worker di pulizia e pass-through sicuro (Brew Panda v2.0.7 ERP)
// Elimina vecchie cache bloccate (es. v1.5 Cache-First) senza mai restituire risposte vuote/rotte.

const CACHE_NAME = 'brew-panda-v207-erp';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(cacheNames => Promise.all(cacheNames.map(name => caches.delete(name))))
      .then(() => {
        if (self.location.hostname === '127.0.0.1' || self.location.hostname === 'localhost') {
          return self.registration.unregister();
        }
      })
      .then(() => self.clients.claim())
      .catch(() => {})
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  if (!event.request.url.startsWith('http')) return;

  event.respondWith(
    fetch(event.request).catch(async () => {
      const cached = await caches.match(event.request);
      if (cached) return cached;
      return new Response('Servizio locale in avvio, ricarica la pagina.', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    })
  );
});
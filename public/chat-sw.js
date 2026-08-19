// Service worker mínimo del chat King. Habilita la instalación (PWA) y un cache
// de shell para que abra rápido. Preparado para push (se activa más adelante).
const CACHE = 'king-chat-v2';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // HTML, manifiesto y brand: siempre red. El nombre de la piel no puede quedar pegado.
  if (req.mode === 'navigate' || url.pathname.endsWith('/manifest') || url.pathname.endsWith('/brand')) {
    event.respondWith(fetch(req));
    return;
  }
  // network-first con fallback a cache (funciona offline para lo ya visto).
  event.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req)),
  );
});

// Web Push (para cuando enchufemos el envío desde el server).
self.addEventListener('push', (event) => {
  let data = { title: 'King 🎰', body: 'Tenés una novedad' };
  try { data = event.data ? event.data.json() : data; } catch (_) {}
  event.waitUntil(self.registration.showNotification(data.title, { body: data.body, icon: '/chat-icon-192.png', badge: '/chat-icon-192.png' }));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: 'window' }).then((cs) => (cs[0] ? cs[0].focus() : self.clients.openWindow('/'))));
});

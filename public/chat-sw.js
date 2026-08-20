// Service worker del chat. Habilita la instalación (PWA) y cachea el shell para
// abrir rápido. IMPORTANTE: nunca servir HTML viejo estando online — el HTML
// referencia chunks de JS con hash; tras un deploy los viejos dan 404 y la app
// no hidrata (se ve el form pero los botones no responden). Por eso navegación =
// network-first y cache solo como fallback offline.
const CACHE = 'king-chat-v3';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function putCache(req, res) {
  const copy = res.clone();
  caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
  return res;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Manifiesto y brand: SIEMPRE red, sin cache (la piel no puede quedar pegada).
  if (url.pathname.endsWith('/manifest') || url.pathname.endsWith('/brand')) {
    event.respondWith(fetch(req));
    return;
  }

  // Navegación (HTML): network-first. Online siempre trae HTML fresco (evita
  // chunks 404 tras deploy). Offline: último HTML conocido como fallback.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => putCache(req, res))
        .catch(() => caches.match(req).then((m) => m || caches.match(url.pathname))),
    );
    return;
  }

  // Resto (chunks con hash, imágenes, css): network-first con fallback a cache.
  event.respondWith(
    fetch(req).then((res) => putCache(req, res)).catch(() => caches.match(req)),
  );
});

// Web Push (Claude): título/cuerpo + url de destino en data.
self.addEventListener('push', (event) => {
  let data = { title: 'King 🎰', body: 'Tenés una novedad' };
  try { data = event.data ? event.data.json() : data; } catch (_) {}
  event.waitUntil(self.registration.showNotification(data.title, {
    body: data.body,
    icon: '/chat-icon-192.png',
    badge: '/chat-icon-192.png',
    data: { url: data.url || '/' },
  }));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(self.clients.matchAll({ type: 'window' }).then((cs) => {
    const c = cs.find((w) => 'focus' in w);
    if (c) return c.focus();
    return self.clients.openWindow(target);
  }));
});

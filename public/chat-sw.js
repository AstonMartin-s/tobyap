// Service worker del chat. Habilita la instalación (PWA) y cachea el shell para
// abrir rápido. IMPORTANTE: nunca servir HTML viejo estando online — el HTML
// referencia chunks de JS con hash; tras un deploy los viejos dan 404 y la app
// no hidrata (se ve el form pero los botones no responden). Por eso navegación =
// network-first y cache solo como fallback offline.
// v4 — Safari/iOS: aviso visual (sin icon/badge) + postMessage si el chat está abierto.
const CACHE = 'king-chat-v4';

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

function parsePush(event) {
  const fallback = { title: 'Tenés un mensaje', body: 'Tenés una novedad', url: '/', tag: '' };
  try {
    if (!event.data) return fallback;
    const raw = event.data.json();
    const n = (raw && (raw.notification || raw.aps && raw.aps.alert)) || raw || {};
    const title = String(n.title || raw.title || fallback.title);
    const body = String(n.body || n.message || raw.body || fallback.body);
    const url = n.url || (raw.data && raw.data.url) || raw.url || fallback.url;
    const tag = String(n.tag || raw.tag || '') || `tobyap-chat-${Date.now()}`;
    return { title: title || fallback.title, body: body || fallback.body, url, tag };
  } catch (_) {
    return { ...fallback, tag: `tobyap-chat-${Date.now()}` };
  }
}

self.addEventListener('push', (event) => {
  const data = parsePush(event);
  event.waitUntil((async () => {
    const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of clientsList) {
      try {
        c.postMessage({ type: 'tobyap-chat-push', title: data.title, body: data.body, url: data.url });
      } catch (_) {}
    }
    return self.registration.showNotification(data.title, {
      body: data.body,
      tag: data.tag,
      data: { url: data.url || '/' },
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(self.clients.matchAll({ type: 'window' }).then((cs) => {
    for (const c of cs) {
      if ('focus' in c) {
        if ('navigate' in c) { try { c.navigate(target); } catch (_) {} }
        return c.focus();
      }
    }
    return self.clients.openWindow(target);
  }));
});

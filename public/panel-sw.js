// Service worker del PANEL del operador (separado del chat-sw.js del cliente).
// Su único trabajo es recibir Web Push de fondo (con el navegador minimizado) y
// abrir el panel de chats al tocar la notificación. Scope: /chats.
// Habilitado para todos los tenants del panel desde ChatsClient.
// v5 — Safari/iOS: aviso visual (sin icon/badge) + postMessage si el panel está
//      abierto + AUTO-RE-SUSCRIPCIÓN (pushsubscriptionchange) para que la sub
//      caducada por iOS se regenere sola y no haya que reactivar a mano.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

function urlB64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function parsePush(event) {
  const fallback = { title: 'TrackerIO · Panel', body: 'Tenés una novedad', url: '/chats', tag: '' };
  try {
    if (!event.data) return fallback;
    const raw = event.data.json();
    const n = (raw && (raw.notification || raw.aps && raw.aps.alert)) || raw || {};
    const title = String(n.title || raw.title || fallback.title);
    const body = String(n.body || n.message || raw.body || fallback.body);
    const url = n.url || (raw.data && raw.data.url) || raw.url || fallback.url;
    const tag = String(n.tag || raw.tag || '') || `tobyap-panel-${Date.now()}`;
    return { title: title || fallback.title, body: body || fallback.body, url, tag };
  } catch (_) {
    return { ...fallback, tag: `tobyap-panel-${Date.now()}` };
  }
}

// Safari/iOS: `new Notification()` desde la página no pinta banner. El push
// sí suena aunque la PWA esté abierta, pero iOS oculta el heads-up → el
// operador oye el ping y no ve el texto. Siempre showNotification (Apple lo
// exige o revoca la sub) Y avisar a las ventanas abiertas.
self.addEventListener('push', (event) => {
  const data = parsePush(event);
  event.waitUntil((async () => {
    const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of clientsList) {
      try {
        c.postMessage({ type: 'tobyap-op-push', title: data.title, body: data.body, url: data.url });
      } catch (_) {}
    }
    // Sin icon/badge: en iOS una URL de icono mala deja el aviso en blanco
    // (suena, no se lee). El ícono de la PWA alcanza.
    return self.registration.showNotification(data.title, {
      body: data.body,
      tag: data.tag,
      renotify: true,
      data: { url: data.url || '/chats' },
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/chats';
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

// AUTO-RE-SUSCRIPCIÓN: iOS/APNs (y a veces Chrome) rotan/caducan la suscripción
// sin aviso. El navegador dispara `pushsubscriptionchange`; acá regeneramos la
// sub con la MISMA VAPID y la re-guardamos en el server. El fetch same-origin
// lleva la cookie de sesión del operador, así que /api/panel/push nos identifica.
// Sin esto, la sub muerta nunca se regenera y hay que tocar "Activar notif" a mano.
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    try {
      // 1) Intentar reusar la applicationServerKey de la sub vieja (si vino).
      let appServerKey = event.oldSubscription && event.oldSubscription.options
        ? event.oldSubscription.options.applicationServerKey
        : null;
      // 2) Si no, pedir la VAPID pública al server (con cookie de sesión).
      if (!appServerKey) {
        const r = await fetch('/api/panel/push', { credentials: 'include' })
          .then((x) => x.json()).catch(() => null);
        if (!r || !r.ok || !r.publicKey) return;
        appServerKey = urlB64ToUint8Array(r.publicKey);
      }
      const sub = await self.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: appServerKey,
      });
      await fetch('/api/panel/push', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: sub }),
      }).catch(() => {});
    } catch (_) { /* best-effort */ }
  })());
});

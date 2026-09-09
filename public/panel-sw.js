// Service worker del PANEL del operador (separado del chat-sw.js del cliente).
// Su único trabajo es recibir Web Push de fondo (con el navegador minimizado) y
// abrir el panel de chats al tocar la notificación. Scope: /chats.
// Solo se registra para tenants manuales (goldenC/ElGanador) desde ChatsClient.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

// Push de fondo: título/cuerpo + url de destino en data. El SONIDO es el del
// sistema (un push de fondo no permite audio custom).
self.addEventListener('push', (event) => {
  let data = { title: 'TrackerIO · Panel', body: 'Tenés una novedad' };
  try { data = event.data ? event.data.json() : data; } catch (_) {}
  event.waitUntil(self.registration.showNotification(data.title, {
    body: data.body,
    icon: '/chat-icon-192.png',
    badge: '/chat-icon-192.png',
    tag: 'tobyap-panel',
    renotify: true,
    data: { url: data.url || '/chats' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/chats';
  event.waitUntil(self.clients.matchAll({ type: 'window' }).then((cs) => {
    // Si ya hay una pestaña del panel abierta, la enfocamos y navegamos.
    for (const c of cs) {
      if ('focus' in c) {
        if ('navigate' in c) { try { c.navigate(target); } catch (_) {} }
        return c.focus();
      }
    }
    return self.clients.openWindow(target);
  }));
});

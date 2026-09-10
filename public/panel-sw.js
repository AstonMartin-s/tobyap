// Service worker del PANEL del operador (separado del chat-sw.js del cliente).
// Su único trabajo es recibir Web Push de fondo (con el navegador minimizado) y
// abrir el panel de chats al tocar la notificación. Scope: /chats.
// Solo se registra para tenants manuales (goldenC/ElGanador) desde ChatsClient.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

// Push de fondo: título/cuerpo + url de destino en data. El SONIDO es el del
// sistema (un push de fondo no permite audio custom). Para que Android lo trate
// como alerta (heads-up + sonido/vibración) y no lo entregue en silencio:
//   - vibrate: patrón → dispara la vibración y el alerta del canal.
//   - renotify + tag: cada evento nuevo VUELVE a sonar (si no, reemplaza mudo).
//   - requireInteraction: queda fija hasta que el operador la toca.
//   - silent:false: nunca silenciosa.
// Si igual no suena, es el canal de notificaciones del navegador/PWA en el
// celular (Ajustes → Apps → Chrome/PWA → Notificaciones → sonido): eso es
// del sistema y no se puede forzar por código.
self.addEventListener('push', (event) => {
  let data = { title: 'TrackerIO · Panel', body: 'Tenés una novedad' };
  try { data = event.data ? event.data.json() : data; } catch (_) {}
  event.waitUntil(self.registration.showNotification(data.title, {
    body: data.body,
    icon: '/chat-icon-192.png',
    badge: '/chat-icon-192.png',
    tag: data.tag || 'tobyap-panel',
    renotify: true,
    requireInteraction: true,
    silent: false,
    vibrate: [300, 120, 300, 120, 300],
    timestamp: Date.now(),
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

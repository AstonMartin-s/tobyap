import webpush from 'web-push';
import { mergeChatData } from '@/lib/chat/mutations';

// Web Push real (entrega con la app/web CERRADA). Es 100% opcional y aditivo:
// si no están las claves VAPID en el entorno, todo queda deshabilitado y el chat
// sigue funcionando con las notificaciones "in-page" de siempre (mientras la
// pestaña está abierta). Nada se rompe si faltan las envs.
//
// Setup (una vez): generar par VAPID y setear en Railway:
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:...)
// Generar con: node -e "console.log(require('web-push').generateVAPIDKeys())"

type PushSub = { endpoint: string; keys?: { p256dh: string; auth: string } };

let configured = false;

function ensureVapid(): boolean {
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return false;
  if (!configured) {
    const subject = process.env.VAPID_SUBJECT || 'mailto:ops@tobyap.com';
    try {
      webpush.setVapidDetails(subject, pub, priv);
      configured = true;
    } catch {
      return false;
    }
  }
  return true;
}

export function pushEnabled(): boolean {
  return !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

export function vapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY || null;
}

/**
 * Envía un push a la suscripción guardada en la sesión. Best-effort, nunca lanza:
 * si no hay VAPID o suscripción, es no-op. Si la suscripción murió (404/410), la
 * limpia de la sesión para no reintentar.
 */
export async function sendPushToSession(
  sessionId: string,
  sub: unknown,
  payload: { title: string; body: string; url?: string },
): Promise<void> {
  if (!ensureVapid()) return;
  if (!sub || typeof sub !== 'object') return;
  const s = sub as PushSub;
  if (!s.endpoint) return;
  try {
    await webpush.sendNotification(s as webpush.PushSubscription, JSON.stringify(payload));
  } catch (e) {
    const code = (e as { statusCode?: number })?.statusCode;
    if (code === 404 || code === 410) {
      await mergeChatData(sessionId, {}, ['pushSub']).catch(() => {});
    }
  }
}

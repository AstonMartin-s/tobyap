import webpush from 'web-push';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { chatSessions, tenants } from '@/db/schema';
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
 * Envío genérico de Web Push a una suscripción cualquiera (cliente u operador).
 * Best-effort, nunca lanza. Devuelve `gone:true` si la suscripción murió
 * (404/410) para que el caller la limpie de su tabla.
 */
export async function sendWebPush(
  sub: unknown,
  payload: { title: string; body: string; url?: string; tag?: string },
): Promise<{ ok: boolean; gone: boolean; status?: number; error?: string }> {
  if (!ensureVapid()) return { ok: false, gone: false, error: 'vapid' };
  if (!sub || typeof sub !== 'object') return { ok: false, gone: false, error: 'no-sub' };
  const s = sub as PushSub;
  if (!s.endpoint) return { ok: false, gone: false, error: 'no-endpoint' };
  try {
    // urgency high: entrega inmediata. TTL 24h: Safari/APNs descarta si el
    // iPhone está un rato offline (TTL 120s de d0f4df7 mataba pings en Safari).
    await webpush.sendNotification(s as webpush.PushSubscription, JSON.stringify(payload), { urgency: 'high', TTL: 86400 });
    return { ok: true, gone: false };
  } catch (e) {
    const err = e as { statusCode?: number; message?: string; body?: string };
    const code = err?.statusCode;
    return { ok: false, gone: code === 404 || code === 410, status: code, error: err?.body || err?.message };
  }
}

/**
 * Envía un push a la suscripción guardada en la sesión. Best-effort, nunca lanza:
 * si no hay VAPID o suscripción, es no-op. Si la suscripción murió (404/410), la
 * limpia de la sesión para no reintentar.
 */
export async function sendPushToSession(
  sessionId: string,
  sub: unknown,
  payload: { title: string; body: string; url?: string; tag?: string },
): Promise<void> {
  const res = await sendWebPush(sub, {
    ...payload,
    tag: payload.tag || `tobyap-chat-${Date.now()}`,
  });
  if (res.gone) {
    await mergeChatData(sessionId, {}, ['pushSub']).catch(() => {});
  }
}

/**
 * Avisa al cliente (Web Push + sonido del SO) cuando NOSOTROS escribimos.
 * Un ping por lote (no uno por burbuja). Best-effort: sin sub = no-op.
 */
export async function notifyClientOutgoing(
  sessionId: string,
  msgs: Array<{ from?: string; text?: string; image?: string; op?: boolean }>,
): Promise<void> {
  try {
    if (!Array.isArray(msgs) || !sessionId) return;
    const outgoing = msgs.filter((m) => m.from === 'bot' || m.op);
    if (!outgoing.length) return;
    const [row] = await db
      .select({ data: chatSessions.data, tenantId: chatSessions.tenantId })
      .from(chatSessions)
      .where(eq(chatSessions.id, sessionId))
      .limit(1);
    if (!row) return;
    const sub = (row.data as Record<string, unknown> | null)?.pushSub;
    if (!sub) return;
    const [t] = await db
      .select({ slug: tenants.slug, name: tenants.name })
      .from(tenants)
      .where(eq(tenants.id, row.tenantId))
      .limit(1);
    const last = [...outgoing].reverse().find((m) => (m.text && m.text.trim()) || m.image) ?? outgoing[outgoing.length - 1];
    const raw = typeof last.text === 'string' ? last.text : '';
    const body = (raw || (last.image ? '📷 Te mandamos una imagen' : 'Tenés un mensaje nuevo'))
      .replace(/\*/g, '')
      .slice(0, 120);
    await sendPushToSession(sessionId, sub, {
      title: t?.name || 'Soporte',
      body,
      url: t?.slug ? `/chat/${t.slug}` : '/',
      tag: `tobyap-chat-${Date.now()}`,
    });
  } catch {
    /* best-effort: un fallo de push no puede tumbar el chat */
  }
}

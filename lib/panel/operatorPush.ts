import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { operatorPushSubs } from '@/db/schema';
import { sendWebPush, pushEnabled } from '@/lib/chat/push';
import type { ResolvedTenant } from '@/lib/types';

// Push de FONDO al operador (panel). Avisa al celular aunque tenga el
// navegador minimizado. Reusa el VAPID del chat del cliente.
//
// GATING: VAPID + suscripciones. Todos los tenants del panel (no solo manual).
// Disparos: mensaje nuevo, pidió usuario, pidió CBU, soporte, comprobante.

export type OperatorPushEvent = 'account_pending' | 'cbu' | 'support' | 'comprobante' | 'message' | 'new_chat';

/** Guarda/actualiza la suscripción push del operador (idempotente por endpoint). */
export async function saveOperatorSub(
  tenantId: string,
  panelUser: string | null,
  subscription: { endpoint?: string } & Record<string, unknown>,
): Promise<boolean> {
  if (!subscription?.endpoint) return false;
  await db
    .insert(operatorPushSubs)
    .values({ tenantId, panelUser, endpoint: subscription.endpoint, subscription })
    .onConflictDoUpdate({
      target: [operatorPushSubs.tenantId, operatorPushSubs.endpoint],
      set: { subscription, panelUser, updatedAt: new Date() },
    });
  return true;
}

const EVENT_COPY: Record<OperatorPushEvent, { title: string; body: string }> = {
  account_pending: { title: 'Pidió usuario', body: 'Un cliente pidió su cuenta. Creala en el panel.' },
  cbu: { title: 'Pidió CBU', body: 'Un cliente pidió el CBU.' },
  support: { title: 'Soporte solicitado', body: 'Un cliente pidió hablar con un agente.' },
  comprobante: { title: 'Comprobante recibido', body: 'Llegó una imagen. Revisala en el panel.' },
  message: { title: 'Mensaje nuevo', body: 'Un cliente escribió en el chat.' },
  new_chat: { title: 'Chat nuevo', body: 'Un cliente acaba de entrar al chat.' },
};

/**
 * Notifica a TODOS los operadores suscriptos del tenant. Best-effort: nunca
 * lanza, limpia suscripciones muertas (404/410). No-op si no hay VAPID o
 * no hay suscripciones.
 */
export async function notifyOperators(
  tenant: ResolvedTenant,
  event: OperatorPushEvent,
  opts: { sessionKey?: string; name?: string | null; text?: string | null } = {},
): Promise<void> {
  if (!pushEnabled()) return;
  let subs: Awaited<ReturnType<typeof loadSubs>>;
  try {
    subs = await loadSubs(tenant.id);
  } catch {
    return;
  }
  if (!subs.length) return;

  const copy = EVENT_COPY[event];
  const who = (opts.name ?? '').trim();
  const snippet = (opts.text ?? '').trim().replace(/\s+/g, ' ').slice(0, 80);
  const body =
    event === 'message' && snippet
      ? (who ? `${who}: ${snippet}` : snippet)
      : who
        ? `${copy.body.replace(/\.$/, '')} (${who}).`
        : copy.body;
  const url = opts.sessionKey ? `/chats?s=${encodeURIComponent(opts.sessionKey)}` : '/chats';
  const tag = `tobyap-panel-${event}-${Date.now()}`;

  const dead: string[] = [];
  let okCount = 0;
  await Promise.all(
    subs.map(async (row) => {
      const res = await sendWebPush(row.subscription, { title: copy.title, body, url, tag });
      if (res.ok) okCount += 1;
      if (res.gone) dead.push(row.endpoint);
      else if (!res.ok) console.warn('[op-push] send fail', { slug: tenant.slug, event, status: res.status, error: res.error });
    }),
  );
  console.log('[op-push]', { slug: tenant.slug, event, subs: subs.length, ok: okCount, dead: dead.length });
  if (dead.length) {
    for (const endpoint of dead) {
      await db
        .delete(operatorPushSubs)
        .where(and(eq(operatorPushSubs.tenantId, tenant.id), eq(operatorPushSubs.endpoint, endpoint)))
        .catch(() => {});
    }
  }
}

function loadSubs(tenantId: string) {
  return db
    .select({ endpoint: operatorPushSubs.endpoint, subscription: operatorPushSubs.subscription })
    .from(operatorPushSubs)
    .where(eq(operatorPushSubs.tenantId, tenantId));
}

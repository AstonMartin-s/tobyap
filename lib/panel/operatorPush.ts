import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { operatorPushSubs } from '@/db/schema';
import { sendWebPush, pushEnabled } from '@/lib/chat/push';
import type { ResolvedTenant } from '@/lib/types';

// Push de FONDO al operador (panel). Solo tiene sentido para tenants manuales
// (goldenC/ElGanador): avisa al celular del operador aunque tenga el navegador
// minimizado. Reusa el VAPID del chat del cliente, con tabla e infra separadas.
//
// GATING: todos los disparos se hacen SOLO cuando tenant.provider === 'manual'.
// En cualquier otro caso es no-op (nadie tiene suscripciones y el guard corta).

export type OperatorPushEvent = 'account_pending' | 'support' | 'comprobante';

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
  account_pending: { title: 'Crear usuario 🧑‍💻', body: 'Un cliente pidió su cuenta. Confirmá la creación en el panel.' },
  support: { title: 'Soporte solicitado 🆘', body: 'Un cliente pidió hablar con un agente.' },
  comprobante: { title: 'Comprobante recibido 📸', body: 'Llegó una imagen de un cliente. Revisala en el panel.' },
};

/**
 * Notifica a TODOS los operadores suscriptos del tenant. Best-effort: nunca
 * lanza, limpia suscripciones muertas (404/410). No-op si el tenant no es
 * manual, si no hay VAPID, o si no hay suscripciones.
 */
export async function notifyOperators(
  tenant: ResolvedTenant,
  event: OperatorPushEvent,
  opts: { sessionKey?: string; name?: string | null } = {},
): Promise<void> {
  if (tenant.provider !== 'manual') return;
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
  const body = who ? `${copy.body.replace(/\.$/, '')} (${who}).` : copy.body;
  const url = opts.sessionKey ? `/chats?s=${encodeURIComponent(opts.sessionKey)}` : '/chats';
  const tag = `tobyap-panel-${event}-${Date.now()}`;

  const dead: string[] = [];
  await Promise.all(
    subs.map(async (row) => {
      const res = await sendWebPush(row.subscription, { title: copy.title, body, url, tag });
      if (res.gone) dead.push(row.endpoint);
    }),
  );
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

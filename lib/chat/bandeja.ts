import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/db';
import { chatSessions } from '@/db/schema';

/** Máximo de chats “en curso” en Inbox. Cargo$, No cargó y Revisar no cuentan para este tope. */
export const BANDEJA_LIMIT = 50;

type Msg = { from?: string; image?: string };

function hasUserComprobante(messages: unknown): boolean {
  if (!Array.isArray(messages)) return false;
  return messages.some((m) => {
    const x = m as Msg;
    return x?.from === 'user' && !!x.image;
  });
}

/** No se auto-archivan: Cargo$ (done), No cargó, o cola Revisar (validando / comprobante pendiente). */
export function isBandejaProtected(step: string | null | undefined, messages: unknown): boolean {
  if (step === 'done' || step === 'no_cargo') return true;
  if (step === 'validando') return true;
  if (step === 'closed') return false;
  const open = step !== 'done' && step !== 'no_cargo' && step !== 'closed';
  return open && hasUserComprobante(messages);
}

/**
 * Mantiene Inbox acotado: archiva automáticamente los chats en curso más viejos
 * cuando pasan de BANDEJA_LIMIT. Cargo$, No cargó y Revisar quedan siempre en Inbox.
 * Reapertura: cliente escribe o manda comprobante → archived false (message/upload).
 */
export async function trimBandeja(tenantId: string): Promise<number> {
  const rows = await db
    .select({
      id: chatSessions.id,
      step: chatSessions.step,
      messages: chatSessions.messages,
    })
    .from(chatSessions)
    .where(
      and(
        eq(chatSessions.tenantId, tenantId),
        sql`coalesce(${chatSessions.data} ->> 'archived', 'false') != 'true'`,
      ),
    )
    .orderBy(desc(chatSessions.updatedAt));

  const trimmable: string[] = [];
  for (const r of rows) {
    if (!isBandejaProtected(r.step, r.messages)) trimmable.push(r.id);
  }

  if (trimmable.length <= BANDEJA_LIMIT) return 0;

  const ids = trimmable.slice(BANDEJA_LIMIT);
  await db
    .update(chatSessions)
    .set({
      data: sql`jsonb_set(coalesce(${chatSessions.data}, '{}'::jsonb), '{archived}', 'true'::jsonb, true)`,
    })
    .where(inArray(chatSessions.id, ids));

  return ids.length;
}

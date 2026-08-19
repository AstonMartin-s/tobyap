import { and, eq, lt } from 'drizzle-orm';
import { db } from '@/db';
import { chatSessions } from '@/db/schema';

// Purga leads "muertos": pasaron a No Cargo, tienen +24h de antigüedad y NUNCA
// respondieron (cero mensajes del cliente — solo el bot habló solo). No sirven
// como historial de conversación real, y si se dejan se acumulan sin límite.
// Se borran de TrackerIO; el lead en KOMMO queda intacto (no se toca).
export async function purgeDeadNoCargo(hours = 24): Promise<{ purged: number }> {
  const cutoff = new Date(Date.now() - hours * 3600 * 1000);
  const rows = await db
    .select({ id: chatSessions.id, messages: chatSessions.messages })
    .from(chatSessions)
    .where(and(eq(chatSessions.step, 'no_cargo'), lt(chatSessions.updatedAt, cutoff)));

  const deadIds = rows
    .filter((r) => !((r.messages ?? []) as Array<{ from: string }>).some((m) => m.from === 'user'))
    .map((r) => r.id);

  let purged = 0;
  for (const id of deadIds) {
    await db.delete(chatSessions).where(eq(chatSessions.id, id));
    purged++;
  }
  return { purged };
}

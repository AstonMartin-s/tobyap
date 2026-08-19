import { and, lt, notInArray } from 'drizzle-orm';
import { db } from '@/db';
import { chatSessions } from '@/db/schema';

// Auto-cierra conversaciones inactivas hace más de N horas (default 72h = 3 días),
// para que el inbox no crezca infinito. No toca las ya cerradas / no_cargo, ni las
// acreditadas (esas quedan como historial de conversión).
export async function autoCloseStale(hours = 72): Promise<{ closed: number }> {
  const cutoff = new Date(Date.now() - hours * 3600 * 1000);
  const res = await db
    .update(chatSessions)
    .set({ step: 'closed', updatedAt: new Date() })
    .where(and(notInArray(chatSessions.step, ['closed', 'no_cargo', 'done']), lt(chatSessions.updatedAt, cutoff)))
    .returning({ id: chatSessions.id });
  return { closed: res.length };
}

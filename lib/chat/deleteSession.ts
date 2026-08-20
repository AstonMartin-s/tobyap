import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { chatSessions } from '@/db/schema';
import { deleteComprobante } from '@/lib/storage';

/** Elimina la fila de chat_sessions y limpia el comprobante en disco si existe. */
export async function purgeChatSession(
  sessionId: string,
  data: Record<string, unknown> | null | undefined,
): Promise<void> {
  const rel = data?.comprobantePath;
  if (typeof rel === 'string' && rel) await deleteComprobante(rel).catch(() => {});
  await db.delete(chatSessions).where(eq(chatSessions.id, sessionId));
}

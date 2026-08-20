import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/db';
import { chatSessions } from '@/db/schema';

/** Máximo de chats no archivados en la bandeja "Todos". El resto se archiva solo. */
export const BANDEJA_LIMIT = 30;

/**
 * Mantiene solo los N chats más recientes sin archivar. Los demás se archivan
 * automáticamente (vuelven si el cliente escribe — ver /message y /upload).
 */
export async function trimBandeja(tenantId: string): Promise<number> {
  const rows = await db
    .select({ id: chatSessions.id })
    .from(chatSessions)
    .where(
      and(
        eq(chatSessions.tenantId, tenantId),
        sql`coalesce(${chatSessions.data} ->> 'archived', 'false') != 'true'`,
      ),
    )
    .orderBy(desc(chatSessions.updatedAt));

  if (rows.length <= BANDEJA_LIMIT) return 0;

  const ids = rows.slice(BANDEJA_LIMIT).map((r) => r.id);
  await db
    .update(chatSessions)
    .set({
      data: sql`jsonb_set(coalesce(${chatSessions.data}, '{}'::jsonb), '{archived}', 'true'::jsonb, true)`,
    })
    .where(inArray(chatSessions.id, ids));

  return ids.length;
}

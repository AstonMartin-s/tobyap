import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { db } from '@/db';
import { chatSessions } from '@/db/schema';
import { deleteComprobante } from '@/lib/storage';

// Limpieza diaria: los comprobantes (imágenes) ya cumplieron su función una vez
// revisados — no hace falta conservarlos para siempre. Pasadas 48h de recibidos,
// se borran del disco (o del base64 en DB, según cómo se hayan guardado) y se
// limpia la referencia en la sesión. El resto de la conversación (texto) queda
// intacto — solo se libera el peso de la imagen.
export async function cleanupOldComprobantes(hours = 48): Promise<{ cleaned: number }> {
  const cutoff = Date.now() - hours * 3600 * 1000;

  const rows = await db
    .select({ id: chatSessions.id, data: chatSessions.data })
    .from(chatSessions)
    .where(and(isNotNull(chatSessions.data), sql`(${chatSessions.data} ->> 'comprobanteAt') is not null`));

  let cleaned = 0;
  for (const r of rows) {
    const data = (r.data ?? {}) as Record<string, unknown>;
    const at = Number(data.comprobanteAt);
    if (!at || at > cutoff) continue;

    if (data.comprobantePath) await deleteComprobante(String(data.comprobantePath));

    const { comprobante, comprobantePath, comprobanteAt, comprobanteMime, comprobanteName, ...rest } = data;
    void comprobante; void comprobantePath; void comprobanteAt; void comprobanteMime; void comprobanteName;
    await db.update(chatSessions).set({ data: { ...rest, comprobanteCleaned: true } }).where(eq(chatSessions.id, r.id));
    cleaned++;
  }
  return { cleaned };
}

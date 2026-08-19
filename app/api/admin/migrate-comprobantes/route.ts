import { NextRequest, NextResponse } from 'next/server';
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { db } from '@/db';
import { chatSessions } from '@/db/schema';
import { isAdmin } from '@/lib/admin-auth';
import { saveComprobante, storageEnabled } from '@/lib/storage';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Migra los comprobantes viejos (base64 en la fila) al volumen de disco. Corre
// EN Railway (donde /data está montado). Idempotente: sólo toca los que tienen
// base64 y todavía no tienen comprobantePath. Procesa en lotes.
// Uso: POST con header x-admin-token: <ADMIN_TOKEN>  (opcional ?limit=)
export async function POST(req: NextRequest) {
  if (!(await isAdmin(req))) return NextResponse.json({ error: 'no autorizado' }, { status: 401 });
  if (!storageEnabled()) return NextResponse.json({ error: 'UPLOAD_DIR no configurado — nada que migrar a disco' }, { status: 400 });

  const limit = Math.min(Number(req.nextUrl.searchParams.get('limit') ?? '400'), 1000);

  // Sesiones con comprobante base64 presente.
  const rows = await db
    .select()
    .from(chatSessions)
    .where(and(isNotNull(chatSessions.data), sql`(${chatSessions.data} ->> 'comprobante') is not null`))
    .limit(limit);

  let migrated = 0;
  let failed = 0;
  for (const s of rows) {
    const data = (s.data ?? {}) as Record<string, unknown>;
    const b64 = data.comprobante as string | undefined;
    if (!b64 || data.comprobantePath) continue;
    try {
      const mime = (data.comprobanteMime as string) || 'image/jpeg';
      const rel = await saveComprobante(s.sessionKey, Buffer.from(b64, 'base64'), mime);
      if (!rel) { failed++; continue; }
      const { comprobante, ...rest } = data; void comprobante;
      await db.update(chatSessions).set({ data: { ...rest, comprobantePath: rel } }).where(eq(chatSessions.id, s.id));
      migrated++;
    } catch {
      failed++;
    }
  }

  // ¿Quedan más?
  const [{ count } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(chatSessions)
    .where(sql`(${chatSessions.data} ->> 'comprobante') is not null`);

  return NextResponse.json({ ok: true, migrated, failed, restantes: count });
}

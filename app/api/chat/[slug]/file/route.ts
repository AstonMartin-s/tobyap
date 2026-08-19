import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { chatSessions } from '@/db/schema';
import { getTenantBySlug } from '@/lib/tenants';
import { readComprobante } from '@/lib/storage';

export const dynamic = 'force-dynamic';

// GET /api/chat/[slug]/file?sessionKey=... — sirve el comprobante de la sesión
// (lo usa el widget para mostrarlo y el operador desde la nota en Kommo).
export async function GET(req: NextRequest, { params }: { params: { slug: string } }) {
  const tenant = await getTenantBySlug(params.slug);
  if (!tenant) return NextResponse.json({ error: 'tenant desconocido' }, { status: 404 });
  const sessionKey = req.nextUrl.searchParams.get('sessionKey');
  if (!sessionKey) return NextResponse.json({ error: 'sessionKey requerido' }, { status: 400 });

  const [s] = await db.select().from(chatSessions).where(and(eq(chatSessions.tenantId, tenant.id), eq(chatSessions.sessionKey, sessionKey)));
  const data = (s?.data as Record<string, unknown> | null) ?? {};
  const mime = (data.comprobanteMime as string) || 'image/jpeg';

  // 1) Volumen (nuevo, barato). 2) base64 en DB (viejo).
  const relPath = data.comprobantePath as string | undefined;
  if (relPath) {
    const buf = await readComprobante(relPath);
    if (buf) return new NextResponse(new Uint8Array(buf), { headers: { 'Content-Type': mime, 'Cache-Control': 'private, max-age=300' } });
  }
  const b64 = data.comprobante as string | undefined;
  if (!b64) return NextResponse.json({ error: 'sin comprobante' }, { status: 404 });
  return new NextResponse(Buffer.from(b64, 'base64'), {
    headers: { 'Content-Type': mime, 'Cache-Control': 'private, max-age=300' },
  });
}

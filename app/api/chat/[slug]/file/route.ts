import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { chatSessions } from '@/db/schema';
import { getTenantBySlug } from '@/lib/tenants';
import { readComprobante } from '@/lib/storage';
import { getSession } from '@/lib/session';
import { verifyFileToken, withinLegacyWindow } from '@/lib/chat/fileToken';

export const dynamic = 'force-dynamic';

// GET /api/chat/[slug]/file?sessionKey=...[&e=&t=]
// HMAC corta vida (notas Kommo). Panel autenticado siempre. sessionKey solo: 14 días.
export async function GET(req: NextRequest, { params }: { params: { slug: string } }) {
  const tenant = await getTenantBySlug(params.slug);
  if (!tenant) return NextResponse.json({ error: 'tenant desconocido' }, { status: 404 });
  const sessionKey = req.nextUrl.searchParams.get('sessionKey');
  if (!sessionKey) return NextResponse.json({ error: 'sessionKey requerido' }, { status: 400 });

  const [s] = await db.select().from(chatSessions).where(and(eq(chatSessions.tenantId, tenant.id), eq(chatSessions.sessionKey, sessionKey)));
  if (!s) return NextResponse.json({ error: 'sesión desconocida' }, { status: 404 });

  const cid = req.nextUrl.searchParams.get('c');
  const signed = verifyFileToken(params.slug, sessionKey, cid, req.nextUrl.searchParams.get('e'), req.nextUrl.searchParams.get('t'));
  const panel = await getSession();
  const panelOk = panel?.slug === params.slug || panel?.role === 'admin';
  const data = (s.data as Record<string, unknown> | null) ?? {};

  // Con cid buscamos el comprobante PUNTUAL en la lista; sin cid, comportamiento
  // legacy (último comprobante en los campos sueltos).
  type Comp = { id?: string; path?: string; b64?: string; mime?: string; at?: number };
  const list = Array.isArray(data.comprobantes) ? (data.comprobantes as Comp[]) : [];
  const entry = cid ? list.find((c) => c?.id === cid) : undefined;
  if (cid && !entry) return NextResponse.json({ error: 'sin comprobante' }, { status: 404 });

  const mime = (entry?.mime as string) || (data.comprobanteMime as string) || 'image/jpeg';
  const atForLegacy = typeof entry?.at === 'number' ? entry.at
    : typeof data.comprobanteAt === 'number' ? data.comprobanteAt
    : s.updatedAt?.getTime();
  const legacyOk = withinLegacyWindow(atForLegacy);

  if (!signed && !panelOk && !legacyOk) {
    return NextResponse.json({ error: 'no autorizado' }, { status: 401 });
  }

  const relPath = entry ? entry.path : (data.comprobantePath as string | undefined);
  if (relPath) {
    const buf = await readComprobante(relPath);
    if (buf) return new NextResponse(new Uint8Array(buf), { headers: { 'Content-Type': mime, 'Cache-Control': 'private, max-age=300' } });
  }
  const b64 = entry ? entry.b64 : (data.comprobante as string | undefined);
  if (!b64) return NextResponse.json({ error: 'sin comprobante' }, { status: 404 });
  return new NextResponse(Buffer.from(b64, 'base64'), {
    headers: { 'Content-Type': mime, 'Cache-Control': 'private, max-age=300' },
  });
}

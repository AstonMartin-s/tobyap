import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { tenants } from '@/db/schema';
import { getSession } from '@/lib/session';
import { updateTenantFields } from '@/lib/tenants';

export const dynamic = 'force-dynamic';

// GET /api/settings/liberador — config del Liberador de Fichas (Partner API) del
// tenant logueado. NUNCA devuelve el token: solo un booleano `hasKey`.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no autenticado' }, { status: 401 });

  const t = await db.query.tenants.findFirst({ where: eq(tenants.id, session.tenantId) });
  if (!t) return NextResponse.json({ error: 'no encontrado' }, { status: 404 });

  return NextResponse.json({
    provider: t.provider ?? 'pagoda',
    partnerApiUrl: t.partnerApiUrl ?? '',
    hasKey: !!t.partnerApiKey,
  });
}

// PUT /api/settings/liberador  { partnerApiUrl, partnerApiKey?, enabled }
// - partnerApiKey solo se guarda si viene con valor (write-only, no se pisa con vacío).
// - `enabled` prende/apaga el modo Partner API (provider). Sin URL/key no se puede prender.
export async function PUT(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no autenticado' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    partnerApiUrl?: string;
    partnerApiKey?: string;
    enabled?: boolean;
  };

  const t = await db.query.tenants.findFirst({ where: eq(tenants.id, session.tenantId) });
  if (!t) return NextResponse.json({ error: 'no encontrado' }, { status: 404 });

  const url = (body.partnerApiUrl ?? '').trim();
  const key = (body.partnerApiKey ?? '').trim();

  // Validación básica de URL si se envió.
  if (url) {
    try {
      const u = new URL(url);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('proto');
    } catch {
      return NextResponse.json({ error: 'URL inválida' }, { status: 400 });
    }
  }

  // Para prender el modo Partner API hace falta URL + (key nueva o ya guardada).
  const willHaveKey = key.length > 0 || !!t.partnerApiKey;
  const willHaveUrl = url.length > 0 || !!t.partnerApiUrl;
  if (body.enabled && (!willHaveUrl || !willHaveKey)) {
    return NextResponse.json({ error: 'para activar hace falta URL y token' }, { status: 400 });
  }

  await updateTenantFields(session.slug, {
    ...(url ? { partnerApiUrl: url } : {}),
    ...(key ? { partnerApiKey: key } : {}), // solo si vino: write-only
    ...(body.enabled !== undefined ? { provider: body.enabled ? 'partner_api' : 'pagoda' } : {}),
  });

  return NextResponse.json({ ok: true });
}

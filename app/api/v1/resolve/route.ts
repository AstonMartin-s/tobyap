import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { attributions, tenants } from '@/db/schema';

// ===========================================================================
// API v1 — Superficie EXTERNA aislada para el CRM 360dialog.
// Módulo autocontenido: solo LEE la tabla attributions (que ya escribe el
// landing/track). No importa ni modifica nada del circuito existente
// (webhook Kommo, atribución, landing). Credencial propia: RESOLVE_API_KEY.
//
//   GET /api/v1/resolve?code=PB6JW9G6
//     200 { code, bono, ccpp, campaign, fbp, fbc, fbclid, eventSourceUrl, ts, client }
//     401 si falta / no coincide la API key (cuando RESOLVE_API_KEY está seteada)
//     404 si el code no existe (o expiró, si RESOLVE_TTL_DAYS está seteada)
// ===========================================================================

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

function authorized(req: NextRequest): boolean {
  const key = process.env.RESOLVE_API_KEY;
  if (!key) return true; // sin key configurada: abierto (setear en prod)
  const bearer = req.headers.get('authorization');
  const apiKey = req.headers.get('x-api-key');
  return bearer === `Bearer ${key}` || apiKey === key;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'no autorizado' }, { status: 401, headers: CORS });
  }

  const code = req.nextUrl.searchParams.get('code')?.trim();
  if (!code) {
    return NextResponse.json({ error: 'code requerido' }, { status: 400, headers: CORS });
  }

  const [row] = await db
    .select({
      code: attributions.code,
      bono: attributions.bono,
      ccpp: attributions.ccpp,
      campaign: attributions.campaignId,
      fbp: attributions.fbp,
      fbc: attributions.fbc,
      fbclid: attributions.fbclid,
      utmSource: attributions.utmSource,
      utmCampaign: attributions.utmCampaign,
      utmContent: attributions.utmContent,
      namead: attributions.namead,
      eventSourceUrl: attributions.eventSourceUrl,
      ts: attributions.createdAt,
      client: tenants.slug,
    })
    .from(attributions)
    .leftJoin(tenants, eq(tenants.id, attributions.tenantId))
    .where(eq(attributions.code, code))
    .limit(1);

  if (!row) {
    return NextResponse.json({ error: 'code no encontrado' }, { status: 404, headers: CORS });
  }

  // Expiración opcional: si RESOLVE_TTL_DAYS está seteada y el code es más viejo, 404.
  const ttlDays = Number(process.env.RESOLVE_TTL_DAYS ?? 0);
  if (ttlDays > 0 && row.ts) {
    const ageMs = Date.now() - new Date(row.ts).getTime();
    if (ageMs > ttlDays * 86_400_000) {
      return NextResponse.json({ error: 'code expirado' }, { status: 404, headers: CORS });
    }
  }

  return NextResponse.json(
    {
      code: row.code,
      bono: row.bono,
      ccpp: row.ccpp,
      campaign: row.campaign,
      fbp: row.fbp,
      fbc: row.fbc,
      fbclid: row.fbclid,
      utm: { source: row.utmSource, campaign: row.utmCampaign, content: row.utmContent },
      namead: row.namead,
      eventSourceUrl: row.eventSourceUrl,
      ts: row.ts,
      client: row.client,
    },
    { headers: CORS },
  );
}

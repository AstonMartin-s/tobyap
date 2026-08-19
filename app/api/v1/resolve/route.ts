import { NextRequest, NextResponse } from 'next/server';
import { desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/db';
import { attributions, sendList, tenants } from '@/db/schema';
import { DEFAULT_BONO_MAP } from '@/lib/attribution';
import { phoneCandidates } from '@/lib/phone';

// ===========================================================================
// API v1 — Superficie EXTERNA aislada para el CRM 360dialog.
// Módulo autocontenido: solo LEE (attributions / send_list). No importa ni
// modifica nada del circuito existente (webhook Kommo, atribución, landing).
// Credencial propia: RESOLVE_API_KEY.
//
//   GET /api/v1/resolve?code=PB6JW9G6   (atribución principal: por token)
//     200 { code, bono, ccpp, campaign, fbp, fbc, fbclid, eventSourceUrl, ts, client }
//     404 si el code no existe (o expiró, si RESOLVE_TTL_DAYS está seteada)
//
//   GET /api/v1/resolve?phone=+5491128471195   (fallback: por lista de envío)
//     200 { phone, ccpp, bono, campaign, client, ts }
//     404 si el teléfono no está en la lista de envío
//
//   401 si falta / no coincide la API key (cuando RESOLVE_API_KEY está seteada)
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

  // --- Fallback por teléfono (lista de envío) -----------------------------
  const phoneParam = req.nextUrl.searchParams.get('phone');
  if (phoneParam != null) {
    const candidates = phoneCandidates(phoneParam);
    if (!candidates.length) {
      return NextResponse.json({ error: 'phone inválido' }, { status: 400, headers: CORS });
    }
    // latest-wins por el último envío (sent_at); si falta, cae a updatedAt.
    const tsExpr = sql<Date>`coalesce(${sendList.sentAt}, ${sendList.updatedAt})`;
    const [row] = await db
      .select({
        phone: sendList.phone,
        ccpp: sendList.ccpp,
        campaign: sendList.campaign,
        portalSlug: sendList.portalSlug,
        ts: tsExpr,
        client: tenants.slug,
        bonoMap: tenants.bonoMap,
      })
      .from(sendList)
      .leftJoin(tenants, eq(tenants.id, sendList.tenantId))
      .where(inArray(sendList.phoneKey, candidates)) // tolera el 9 móvil AR
      .orderBy(desc(tsExpr)) // latest-wins si hubo varios envíos
      .limit(1);

    if (!row) {
      return NextResponse.json({ error: 'phone no encontrado' }, { status: 404, headers: CORS });
    }
    const map = { ...DEFAULT_BONO_MAP, ...(row.bonoMap ?? {}) };
    return NextResponse.json(
      {
        phone: row.phone,
        ccpp: row.ccpp,
        bono: map[row.ccpp] ?? null,
        portal_slug: row.portalSlug ?? null,
        campaign: row.campaign ?? null,
        client: row.client,
        ts: row.ts,
      },
      { headers: CORS },
    );
  }

  const code = req.nextUrl.searchParams.get('code')?.trim();
  if (!code) {
    return NextResponse.json({ error: 'code o phone requerido' }, { status: 400, headers: CORS });
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

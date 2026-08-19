import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { db } from '@/db';
import { metaEvents, attributions } from '@/db/schema';
import { getTenantBySlug } from '@/lib/tenants';
import { generateCode, resolveBono } from '@/lib/attribution';
import { clientIp, rateLimit } from '@/lib/rateLimit';

// ---------------------------------------------------------------------------
// POST /api/track/redirect
//   { slug, campaign?, ccpp?, fbp?, fbc?, fbclid?, utmSource?, utmCampaign?,
//     utmContent?, namead?, eventSourceUrl? }
//
// 1) Registra la VISITA (redirect) -> reporte admin.
// 2) Genera un TOKEN único, guarda la atribución completa y devuelve { code }.
//    La landing mete ese code en el mensaje de WhatsApp; al llegar el lead lo
//    matcheamos y asignamos etiquetas (campaña + bono) + fbclid/utm.
// Endpoint público (landing en otro dominio): CORS habilitado.
// ---------------------------------------------------------------------------

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(req: NextRequest) {
  const limit = Number(process.env.RATE_LIMIT_REDIRECT ?? 60);
  const rl = rateLimit(`redirect:${clientIp(req)}`, limit, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'rate limit' },
      { status: 429, headers: { ...CORS, 'Retry-After': String(rl.retryAfterSec) } },
    );
  }

  let b: Record<string, string | undefined>;
  try {
    b = await req.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400, headers: CORS });
  }
  if (!b.slug) return NextResponse.json({ error: 'slug requerido' }, { status: 400, headers: CORS });

  const tenant = await getTenantBySlug(b.slug);
  if (!tenant) return NextResponse.json({ error: 'tenant desconocido' }, { status: 404, headers: CORS });

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
  const userAgent = req.headers.get('user-agent') ?? null;
  // Sanitizamos campaign/ccpp: tomamos SOLO el prefijo alfanumérico (+ - _) para
  // que un valor contaminado (ej. "CC1.kommo.com/leads/pipeline/...") no genere
  // un tag basura ni ensucie la atribución.
  const cleanParam = (v?: string | null, max = 40): string | null => {
    const m = (v ?? '').match(/^[A-Za-z0-9_-]+/);
    return m ? m[0].slice(0, max) : null;
  };
  const campaignId = cleanParam(b.campaign ?? b.campaignId ?? b.utmCampaign, 40);
  const ccpp = cleanParam(b.ccpp, 12);
  const bono = resolveBono(tenant, ccpp);

  // 1) Visita (redirect) para el reporte.
  await db.insert(metaEvents).values({
    tenantId: tenant.id,
    eventName: `RedirectCRM${tenant.eventSuffix}`,
    eventId: `redirect:${crypto.randomUUID()}`,
    eventType: 'redirect',
    campaignId,
    conversionData: {
      ccpp: ccpp,
      bono,
      fbp: b.fbp ?? null,
      fbc: b.fbc ?? null,
      fbclid: b.fbclid ?? null,
      event_source_url: b.eventSourceUrl ?? null,
      client_ip_address: ip,
      client_user_agent: userAgent,
    },
    status: 'sent',
    success: true,
    sentAt: new Date(),
  });

  // 2) Token de atribución (reintentar si choca el code, muy improbable).
  let code = generateCode();
  for (let i = 0; i < 3; i++) {
    try {
      await db.insert(attributions).values({
        tenantId: tenant.id,
        code,
        campaignId,
        ccpp: ccpp,
        bono,
        fbclid: b.fbclid ?? null,
        fbp: b.fbp ?? null,
        fbc: b.fbc ?? null,
        utmSource: b.utmSource ?? null,
        utmCampaign: b.utmCampaign ?? null,
        utmContent: b.utmContent ?? null,
        namead: b.namead ?? null,
        eventSourceUrl: b.eventSourceUrl ?? null,
      });
      break;
    } catch {
      code = generateCode();
    }
  }

  return NextResponse.json({ ok: true, code, bono, campaignId }, { headers: CORS });
}

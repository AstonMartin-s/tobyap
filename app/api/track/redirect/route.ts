import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { db } from '@/db';
import { metaEvents } from '@/db/schema';
import { getTenantBySlug } from '@/lib/tenants';

// ---------------------------------------------------------------------------
// POST /api/track/redirect  { slug, campaignId?, fbp?, fbc?, fbclid?, eventSourceUrl? }
//
// Registra una VISITA (redirect) desde la landing propia del cliente. Cada visita
// es un evento independiente (eventType 'redirect') => alimenta el reporte admin.
// Endpoint público (la landing corre en otro dominio): habilitamos CORS.
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
  let body: {
    slug?: string;
    campaignId?: string;
    fbp?: string;
    fbc?: string;
    fbclid?: string;
    eventSourceUrl?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400, headers: CORS });
  }

  if (!body.slug) {
    return NextResponse.json({ error: 'slug requerido' }, { status: 400, headers: CORS });
  }

  const tenant = await getTenantBySlug(body.slug);
  if (!tenant) {
    return NextResponse.json({ error: 'tenant desconocido' }, { status: 404, headers: CORS });
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
  const userAgent = req.headers.get('user-agent') ?? null;

  await db.insert(metaEvents).values({
    tenantId: tenant.id,
    eventName: `RedirectCRM${tenant.eventSuffix}`,
    eventId: `redirect:${crypto.randomUUID()}`, // cada visita es única
    eventType: 'redirect',
    campaignId: body.campaignId ?? null,
    conversionData: {
      fbp: body.fbp ?? null,
      fbc: body.fbc ?? null,
      fbclid: body.fbclid ?? null,
      event_source_url: body.eventSourceUrl ?? null,
      client_ip_address: ip,
      client_user_agent: userAgent,
    },
    status: 'sent',
    success: true,
    sentAt: new Date(),
  });

  return NextResponse.json({ ok: true }, { headers: CORS });
}

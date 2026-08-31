import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { tenants } from '@/db/schema';
import { getSession } from '@/lib/session';
import { updateTenantFields } from '@/lib/tenants';

export const dynamic = 'force-dynamic';

function publicBase(): string {
  return (process.env.APP_PUBLIC_URL || 'https://tobyap-production.up.railway.app').replace(/\/+$/, '');
}

// GET /api/settings/affiliate-webhook — estado del webhook de afiliados Telegram.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no autenticado' }, { status: 401 });

  const t = await db.query.tenants.findFirst({ where: eq(tenants.id, session.tenantId) });
  if (!t) return NextResponse.json({ error: 'no encontrado' }, { status: 404 });

  return NextResponse.json({
    hasSecret: !!t.affiliateWebhookSecret,
    webhookUrl: `${publicBase()}/api/webhooks/affiliate/${t.slug}`,
  });
}

// PUT /api/settings/affiliate-webhook  { secret?, generate? }
//   secret   → guarda el secreto compartido (cifrado). Vacío = no cambia.
//   generate → genera un secreto aleatorio y lo devuelve UNA sola vez.
export async function PUT(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no autenticado' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { secret?: string; generate?: boolean };

  let secret = (body.secret ?? '').trim();
  let generated: string | null = null;
  if (body.generate) {
    secret = crypto.randomBytes(32).toString('hex');
    generated = secret;
  }
  if (!secret) return NextResponse.json({ error: 'secreto vacío' }, { status: 400 });
  if (secret.length < 16) {
    return NextResponse.json({ error: 'el secreto debe tener al menos 16 caracteres' }, { status: 400 });
  }

  await updateTenantFields(session.slug, { affiliateWebhookSecret: secret });

  return NextResponse.json({ ok: true, ...(generated ? { secret: generated } : {}) });
}

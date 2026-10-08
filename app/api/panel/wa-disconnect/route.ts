import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getTenantBySlug, invalidateTenant, updateTenantFields } from '@/lib/tenants';
import { blasterConfig, blasterLineIds, blasterLogout, forgetLinePhone, packLineIds } from '@/lib/blaster';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no autenticado' }, { status: 401 });
  if (session.panelRole === 'operador') return NextResponse.json({ error: 'sin permiso' }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as { sessionId?: string };
  const tenant = await getTenantBySlug(session.slug);
  if (!tenant) return NextResponse.json({ error: 'canal WhatsApp no configurado' }, { status: 409 });
  const cfg = blasterConfig(tenant, typeof body.sessionId === 'string' ? body.sessionId : undefined, true);
  if (!cfg) return NextResponse.json({ error: 'canal WhatsApp no configurado' }, { status: 409 });

  const r = await blasterLogout(cfg);
  if (!r.ok) {
    return NextResponse.json({
      error: `no se pudo desconectar: ${r.error ?? 'error'}`,
    }, { status: 502 });
  }
  forgetLinePhone(cfg.sessionId);
  const next = blasterLineIds(tenant).filter((id) => id !== cfg.sessionId);
  await updateTenantFields(tenant.slug, packLineIds(next));
  invalidateTenant(tenant.slug);
  return NextResponse.json({ ok: true, sessionId: cfg.sessionId, removed: true });
}

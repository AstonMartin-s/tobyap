import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getTenantBySlug } from '@/lib/tenants';
import { blasterConfig, blasterLogout } from '@/lib/blaster';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no autenticado' }, { status: 401 });
  if (session.panelRole === 'operador') return NextResponse.json({ error: 'sin permiso' }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as { sessionId?: string };
  const tenant = await getTenantBySlug(session.slug);
  const cfg = tenant ? blasterConfig(tenant, typeof body.sessionId === 'string' ? body.sessionId : undefined) : null;
  if (!cfg) return NextResponse.json({ error: 'canal WhatsApp no configurado' }, { status: 409 });

  const r = await blasterLogout(cfg);
  if (!r.ok) {
    return NextResponse.json({
      error: `no se pudo desconectar: ${r.error ?? 'error'}`,
    }, { status: 502 });
  }
  return NextResponse.json({ ok: true, sessionId: cfg.sessionId });
}

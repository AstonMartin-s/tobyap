import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getTenantBySlug, invalidateTenant, updateTenantFields } from '@/lib/tenants';
import { blasterAuth, blasterLineIds, blasterLogout, forgetLinePhone, packLineIds } from '@/lib/blaster';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no autenticado' }, { status: 401 });
  if (session.panelRole === 'operador') return NextResponse.json({ error: 'sin permiso' }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as { sessionId?: string };
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
  const tenant = await getTenantBySlug(session.slug);
  const auth = tenant ? blasterAuth(tenant) : null;
  if (!tenant || !auth || !sessionId) return NextResponse.json({ error: 'canal WhatsApp no configurado' }, { status: 409 });

  await blasterLogout({ ...auth, sessionId }).catch(() => ({ ok: false }));
  forgetLinePhone(sessionId);
  const next = blasterLineIds(tenant).filter((id) => id !== sessionId);
  await updateTenantFields(tenant.slug, packLineIds(next));
  invalidateTenant(tenant.slug);
  return NextResponse.json({ ok: true, sessionId });
}

import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getTenantBySlug, invalidateTenant, updateTenantFields } from '@/lib/tenants';
import { blasterAuth, blasterLineIds, blasterState, lineIsLinked, packLineIds, phoneFromJid, rememberLinePhone, MAX_BLASTER_LINES } from '@/lib/blaster';

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

  const state = await blasterState({ ...auth, sessionId });
  const phone = phoneFromJid(state?.jid ?? null);
  if (!lineIsLinked(state?.status, phone)) {
    return NextResponse.json({ error: 'todavía no está vinculada' }, { status: 409 });
  }

  const ids = blasterLineIds(tenant);
  if (ids.includes(sessionId)) return NextResponse.json({ ok: true, sessionId, already: true });
  if (ids.length >= MAX_BLASTER_LINES) {
    return NextResponse.json({ error: `máximo ${MAX_BLASTER_LINES} números` }, { status: 409 });
  }

  rememberLinePhone(sessionId, phone);
  await updateTenantFields(tenant.slug, packLineIds([...ids, sessionId]));
  invalidateTenant(tenant.slug);
  return NextResponse.json({ ok: true, sessionId });
}

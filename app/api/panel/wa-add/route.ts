import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getTenantBySlug } from '@/lib/tenants';
import {
  appPublicUrl,
  blasterAuth,
  blasterConnect,
  blasterCreateTracker,
  blasterLineIds,
  MAX_BLASTER_LINES,
} from '@/lib/blaster';

export const dynamic = 'force-dynamic';

// Crea el tracker y pide QR. NO se guarda en el tenant hasta que vincule
// (POST /api/panel/wa-commit).
export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no autenticado' }, { status: 401 });
  if (session.panelRole === 'operador') return NextResponse.json({ error: 'sin permiso' }, { status: 403 });

  const tenant = await getTenantBySlug(session.slug);
  const auth = tenant ? blasterAuth(tenant) : null;
  if (!tenant || !auth) return NextResponse.json({ error: 'canal WhatsApp no configurado' }, { status: 409 });

  const secret = (tenant.waInboundSecret ?? '').trim();
  if (!secret) return NextResponse.json({ error: 'falta el secreto de entrada' }, { status: 409 });

  const saved = blasterLineIds(tenant);
  if (saved.length >= MAX_BLASTER_LINES) {
    return NextResponse.json({ error: `máximo ${MAX_BLASTER_LINES} números` }, { status: 409 });
  }

  const created = await blasterCreateTracker(auth, {
    label: `${tenant.name} inbox ${saved.length + 1}`,
    forwardUrl: `${appPublicUrl()}/api/chat/${encodeURIComponent(tenant.slug)}/wa-in`,
    forwardSecret: secret,
  });
  if ('error' in created) {
    return NextResponse.json({ error: `no se pudo crear la línea: ${created.error}` }, { status: 502 });
  }

  await blasterConnect({ ...auth, sessionId: created.id });
  return NextResponse.json({ ok: true, sessionId: created.id, max: MAX_BLASTER_LINES });
}

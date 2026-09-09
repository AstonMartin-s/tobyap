import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getTenantBySlug } from '@/lib/tenants';
import { pushEnabled, vapidPublicKey } from '@/lib/chat/push';
import { saveOperatorSub } from '@/lib/panel/operatorPush';

export const dynamic = 'force-dynamic';

// GET /api/panel/push → clave pública VAPID para suscribir al operador.
// Solo habilitado para tenants provider='manual' (goldenC/ElGanador). Reusa el
// VAPID compartido con el chat del cliente.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  const tenant = await getTenantBySlug(session.slug);
  const manual = tenant?.provider === 'manual';
  return NextResponse.json({ ok: pushEnabled() && manual, manual, publicKey: manual ? vapidPublicKey() : null });
}

// POST /api/panel/push  { subscription } → guarda la suscripción push del operador.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  if (!pushEnabled()) return NextResponse.json({ ok: false, disabled: true });
  const tenant = await getTenantBySlug(session.slug);
  if (!tenant || tenant.provider !== 'manual') {
    return NextResponse.json({ ok: false, skip: true });
  }
  const body = (await req.json().catch(() => null)) as {
    subscription?: ({ endpoint?: string } & Record<string, unknown>);
  } | null;
  const subscription = body?.subscription;
  if (!subscription?.endpoint) {
    return NextResponse.json({ error: 'subscription requerida' }, { status: 400 });
  }
  const who = session.userId || session.displayName || null;
  const ok = await saveOperatorSub(session.tenantId, who, subscription);
  return NextResponse.json({ ok });
}

import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getTenantBySlug } from '@/lib/tenants';
import { blasterConfig, blasterConnect, blasterState } from '@/lib/blaster';

export const dynamic = 'force-dynamic';

export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no autenticado' }, { status: 401 });

  const tenant = await getTenantBySlug(session.slug);
  const cfg = tenant ? blasterConfig(tenant) : null;
  if (!cfg) return NextResponse.json({ error: 'canal WhatsApp no configurado' }, { status: 409 });

  // Cuidar la línea: con el vínculo sano no se toca nada. WhatsApp penaliza el
  // re-linkeo en ráfaga, y un connect de más solo puede hacer daño.
  const current = await blasterState(cfg);
  if (current?.status === 'connected') {
    return NextResponse.json({ ok: true, skipped: 'ya conectado', status: current.status });
  }

  const r = await blasterConnect(cfg);
  if (!r.ok) return NextResponse.json({ error: `no se pudo reconectar: ${r.error ?? 'error'}` }, { status: 502 });
  return NextResponse.json({ ok: true });
}

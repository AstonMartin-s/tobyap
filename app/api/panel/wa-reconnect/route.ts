import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getTenantBySlug } from '@/lib/tenants';
import { blasterConfig, blasterConnect } from '@/lib/blaster';

export const dynamic = 'force-dynamic';

// POST /api/panel/wa-reconnect
// Proxy al connect de la sesión de Blaster del tenant (para el botón "Reconectar"
// del chip de estado). Reusa la reconexión propia de Blaster; no reimplementa nada.

export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no autenticado' }, { status: 401 });

  const tenant = await getTenantBySlug(session.slug);
  const cfg = tenant ? blasterConfig(tenant) : null;
  if (!cfg) return NextResponse.json({ error: 'canal WhatsApp no configurado' }, { status: 409 });

  const r = await blasterConnect(cfg);
  if (!r.ok) return NextResponse.json({ error: `no se pudo reconectar: ${r.error ?? 'error'}` }, { status: 502 });
  return NextResponse.json({ ok: true });
}

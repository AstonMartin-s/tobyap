import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { kommoWebhookLog } from '@/db/schema';
import { getTenantBySlug } from '@/lib/tenants';

// POST /api/retiro/[slug] — lo llama el bot RETIRO (send_hook). Por ahora solo
// registramos el pedido de retiro (no dispara conversión). Stub para que el bot
// no apunte a un host externo.
export async function POST(req: NextRequest, { params }: { params: { slug: string } }) {
  const tenant = await getTenantBySlug(params.slug);
  if (!tenant) return NextResponse.json({ error: 'tenant desconocido' }, { status: 404 });
  const raw = await req.text();
  db.insert(kommoWebhookLog)
    .values({ tenantId: tenant.id, body: { source: 'retiro', raw }, processed: false })
    .catch(() => {});
  return NextResponse.json({ ok: true });
}

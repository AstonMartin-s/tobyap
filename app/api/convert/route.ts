import { NextRequest, NextResponse } from 'next/server';
import { eq, and } from 'drizzle-orm';
import { db } from '@/db';
import { leads } from '@/db/schema';
import { getSession } from '@/lib/session';
import { getTenantBySlug } from '@/lib/tenants';
import { emitCargo } from '@/lib/cargo/emit';

// POST /api/convert  { kommoLeadId, value?, currency? }
// Marca el lead convertido y dispara CargoCRM<suffix> vía emitCargo. Requiere sesión.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no autenticado' }, { status: 401 });

  const tenant = await getTenantBySlug(session.slug);
  if (!tenant) return NextResponse.json({ error: 'tenant no encontrado' }, { status: 404 });

  let input: { kommoLeadId?: number; value?: number; currency?: string };
  try {
    input = await req.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }
  if (!input.kommoLeadId) {
    return NextResponse.json({ error: 'kommoLeadId requerido' }, { status: 400 });
  }

  const lead = await db.query.leads.findFirst({
    where: and(eq(leads.tenantId, tenant.id), eq(leads.kommoLeadId, input.kommoLeadId)),
  });
  if (!lead) return NextResponse.json({ error: 'lead no encontrado' }, { status: 404 });

  const result = await emitCargo(tenant, {
    kommoLeadId: input.kommoLeadId,
    source: 'convert',
    operator: session.slug,
    userData: { fbc: lead.fbc, fbp: lead.fbp, fbclid: lead.fbclid, phone: lead.phone },
    campaign: lead.campaignId,
    leadRowId: lead.id,
    eventSourceUrl: lead.eventSourceUrl,
    value: input.value,
    currency: input.currency,
    skipKommoStatus: true,
  });

  return NextResponse.json({ ok: result.ok, meta: result.capi ?? result });
}

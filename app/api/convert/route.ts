import { NextRequest, NextResponse } from 'next/server';
import { eq, and } from 'drizzle-orm';
import { db } from '@/db';
import { leads } from '@/db/schema';
import { getSession } from '@/lib/session';
import { getTenantBySlug } from '@/lib/tenants';
import { sendCapiEvent } from '@/lib/meta';

// POST /api/convert  { kommoLeadId, value?, currency? }
// Marca el lead convertido y dispara CargoCRM<suffix>. Requiere sesión.
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

  // Buscar el lead espejado de este tenant.
  const lead = await db.query.leads.findFirst({
    where: and(eq(leads.tenantId, tenant.id), eq(leads.kommoLeadId, input.kommoLeadId)),
  });
  if (!lead) return NextResponse.json({ error: 'lead no encontrado' }, { status: 404 });

  const result = await sendCapiEvent(tenant, {
    eventName: 'Cargo',
    eventId: `cargo-${input.kommoLeadId}`, // determinístico => idempotente
    userData: { fbc: lead.fbc, fbp: lead.fbp, fbclid: lead.fbclid, phone: lead.phone },
    customData: {
      internal_event: 'CargoCRM',
      ...(input.value ? { value: input.value, currency: input.currency ?? 'ARS' } : {}),
    },
    eventSourceUrl: lead.eventSourceUrl,
    leadId: lead.id,
  });

  await db.update(leads).set({ converted: true, updatedAt: new Date() }).where(eq(leads.id, lead.id));

  return NextResponse.json({ ok: result.ok, meta: result });
}

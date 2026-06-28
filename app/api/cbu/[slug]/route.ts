import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { clientSettings } from '@/db/schema';
import { getTenantBySlug } from '@/lib/tenants';
import { updateLeadFields, parseLeadIds } from '@/lib/kommo';

// ---------------------------------------------------------------------------
// POST /api/cbu/[slug]
//
// Lo llama el BOT "CBU" (Kommo salesbot send_hook). Escribe en el lead el CBU y el
// Titular configurados en el panel (Configuración General → CBU / Nombre de cuenta),
// para que el siguiente mensaje del bot los muestre con {{lead.cf.<id>}}.
//
// El tenant define en customFields qué campos de Kommo escribir:
//   cbu_field      -> id del custom field "CBU/CVU"
//   titular_field  -> id del custom field "Titular/Alias"
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest, { params }: { params: { slug: string } }) {
  const tenant = await getTenantBySlug(params.slug);
  if (!tenant) return NextResponse.json({ error: 'tenant desconocido' }, { status: 404 });

  const cbuField = tenant.customFields['cbu_field'];
  const titularField = tenant.customFields['titular_field'];
  if (!cbuField && !titularField) {
    return NextResponse.json({ error: 'tenant sin cbu_field/titular_field configurados' }, { status: 400 });
  }

  const [s] = await db.select().from(clientSettings).where(eq(clientSettings.tenantId, tenant.id));
  const cbu = s?.accountCbu ?? '';
  const titular = s?.accountName ?? '';

  const raw = await req.text();
  const leadIds = parseLeadIds(raw, req.nextUrl.searchParams);
  if (!leadIds.length) return NextResponse.json({ ok: true, processed: 0, note: 'sin lead id' });

  const results: unknown[] = [];
  for (const leadId of leadIds) {
    const fields: Array<{ fieldId: number; value: string }> = [];
    if (cbuField && cbu) fields.push({ fieldId: cbuField, value: cbu });
    if (titularField && titular) fields.push({ fieldId: titularField, value: titular });
    try {
      const ok = await updateLeadFields(tenant, leadId, fields);
      results.push({ leadId, ok, wrote: fields.length });
    } catch (e) {
      results.push({ leadId, error: String(e) });
    }
  }

  return NextResponse.json({ ok: true, cbu, titular, processed: results.length, results });
}

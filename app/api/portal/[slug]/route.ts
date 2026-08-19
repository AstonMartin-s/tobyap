import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { kommoWebhookLog } from '@/db/schema';
import { getTenantBySlug } from '@/lib/tenants';
import { createPortalAccount, buildPortalName } from '@/lib/pagoda';
import { fetchKommoLead, readPhone, readLeadField, updateLeadFields, updateLeadName, parseLeadIds, fetchContactInfo, contactId } from '@/lib/kommo';

// ---------------------------------------------------------------------------
// POST /api/portal/[slug]
//
// Lo llama el BOT del cliente (Kommo salesbot send_hook) en el nodo donde antes
// se creaba el usuario a mano. Toma teléfono + nombre del lead, le pide a Pagoda
// una cuenta de portal y escribe login_url / usuario / clave en custom fields
// del lead para que el siguiente mensaje del bot los muestre con {{lead.cf.<id>}}.
//
// customFields del tenant que se usan:
//   portal_url_field   -> id del custom field "PORTAL_URL"
//   portal_user_field  -> id del custom field "PORTAL_USER"
//   portal_pass_field  -> id del custom field "PORTAL_PASS"
// ---------------------------------------------------------------------------

// GET = health-check (Kommo valida la URL con GET antes de guardarla).
export async function GET(_req: NextRequest, { params }: { params: { slug: string } }) {
  const tenant = await getTenantBySlug(params.slug);
  return NextResponse.json({ ok: true, tenant: tenant ? params.slug : null });
}

export async function POST(req: NextRequest, { params }: { params: { slug: string } }) {
  const tenant = await getTenantBySlug(params.slug);
  if (!tenant) return NextResponse.json({ error: 'tenant desconocido' }, { status: 404 });
  if (!tenant.pagodaUrl || !tenant.pagodaApiKey) {
    return NextResponse.json({ error: 'tenant sin integración Pagoda configurada' }, { status: 400 });
  }

  const raw = await req.text();
  db.insert(kommoWebhookLog)
    .values({ tenantId: tenant.id, body: { source: 'portal', raw }, processed: false })
    .catch(() => {});

  const leadIds = parseLeadIds(raw, req.nextUrl.searchParams);
  if (!leadIds.length) return NextResponse.json({ ok: true, processed: 0, note: 'sin lead id' });

  const urlField = tenant.customFields['portal_url_field'];
  const userField = tenant.customFields['portal_user_field'];
  const passField = tenant.customFields['portal_pass_field'];

  const results: unknown[] = [];
  // Espejo a nivel-raíz de las credenciales del primer lead resuelto: así el nodo
  // HTTP del salesbot puede capturarlas en una variable sin depender del selector
  // de custom fields de Kommo (que tarda en indexar campos nuevos).
  let top: { login_url: string | null; username: string | null; password: string | null } | null = null;
  for (const leadId of leadIds) {
    try {
      const lead = await fetchKommoLead(tenant, leadId);
      // El teléfono y el NOMBRE DE WHATSAPP viven en el contacto (no en el lead:
      // su título suele ser un placeholder "Lead #123"). Los pedimos aparte.
      let phone = readPhone(lead);
      let contactName: string | null = null;
      const cId = contactId(lead);
      if (cId) {
        const info = await fetchContactInfo(tenant, cId);
        phone = phone ?? info.phone;
        contactName = info.name;
      }
      if (!phone) {
        results.push({ leadId, error: 'lead sin teléfono' });
        continue;
      }

      // Idempotencia local: si el lead ya tiene login_url escrito, no repetimos.
      const already = urlField ? readLeadField(lead, urlField) : null;
      if (already) {
        results.push({ leadId, skipped: 'ya tenía login_url' });
        continue;
      }

      // El nombre que pedimos a Pagoda lo derivamos del nombre de WhatsApp del
      // contacto (5 letras + 4 dígitos + 1 letra): siempre válido e identificable.
      const portalName = buildPortalName(contactName ?? lead.name);
      const acc = await createPortalAccount(tenant, { phone, name: portalName });

      const fields: Array<{ fieldId: number; value: string }> = [];
      if (urlField && acc.loginUrl) fields.push({ fieldId: urlField, value: acc.loginUrl });
      if (userField && acc.username) fields.push({ fieldId: userField, value: acc.username });
      if (passField && acc.password) fields.push({ fieldId: passField, value: acc.password });
      if (fields.length) await updateLeadFields(tenant, leadId, fields);

      // Automatiza el paso manual del empleado: el título del lead pasa a ser el
      // username creado (sobrescribe el "Lead #123"). Así no hay que copiar/pegar.
      if (acc.username) await updateLeadName(tenant, leadId, acc.username);

      if (!top) top = { login_url: acc.loginUrl, username: acc.username, password: acc.password };

      results.push({
        leadId,
        wrote: fields.length,
        existing: acc.existing,
        // devolvemos también en la respuesta por si el bot quiere capturarla
        login_url: acc.loginUrl,
        username: acc.username,
        password: acc.password,
      });
    } catch (e) {
      console.error(`[portal ${tenant.slug}] lead ${leadId}:`, e);
      results.push({ leadId, error: String(e) });
    }
  }

  return NextResponse.json({
    ok: true,
    processed: results.length,
    login_url: top?.login_url ?? null,
    username: top?.username ?? null,
    password: top?.password ?? null,
    results,
  });
}

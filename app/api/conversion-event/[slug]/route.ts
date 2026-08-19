import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { kommoWebhookLog } from '@/db/schema';
import { getTenantBySlug } from '@/lib/tenants';
import { emitCargo } from '@/lib/cargo/emit';

// ---------------------------------------------------------------------------
// POST /api/conversion-event/[slug]
//
// Lo llama el BOT "CARGO" del embudo (Kommo salesbot send_hook) cuando se confirma
// una carga. Es la fuente AUTORITATIVA de la conversión de carga: el bot decide
// cuándo, y acto seguido mueve el lead a "Clientes regulares" — por eso NO podemos
// depender del cambio de estado. Dispara CargoCRM<suffix> vía emitCargo (idempotente).
// ---------------------------------------------------------------------------

// Extrae el/los lead id del payload (form de Kommo send_hook, JSON o query).
function extractLeadIds(raw: string, url: URL): number[] {
  const ids = new Set<number>();
  const q = url.searchParams.get('lead_id') || url.searchParams.get('id');
  if (q && /^\d+$/.test(q)) ids.add(Number(q));
  // El form del salesbot suele venir URL-encoded (leads%5Badd%5D%5B0%5D%5Bid%5D=..).
  // Decodificamos y tomamos SOLO las claves de leads[...][id] (nunca account[id]).
  // Sin este decode el parser devolvía [] y NO se medía ninguna carga.
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw.replace(/\+/g, ' '));
  } catch {
    /* raw no era URL-encoding válido */
  }
  for (const m of decoded.matchAll(/leads\[[^\]]*\](?:\[[^\]]*\])*\[id\]=(\d+)/g)) ids.add(Number(m[1]));
  // JSON: { lead_id } o { leads: [{id}] }
  try {
    const j = JSON.parse(raw);
    if (j.lead_id) ids.add(Number(j.lead_id));
    if (Array.isArray(j.leads)) for (const l of j.leads) if (l?.id) ids.add(Number(l.id));
  } catch {
    /* no era JSON */
  }
  return [...ids];
}

export async function POST(req: NextRequest, { params }: { params: { slug: string } }) {
  const tenant = await getTenantBySlug(params.slug);
  if (!tenant) return NextResponse.json({ error: 'tenant desconocido' }, { status: 404 });

  const raw = await req.text();
  db.insert(kommoWebhookLog)
    .values({ tenantId: tenant.id, body: { source: 'conversion-event', raw }, processed: false })
    .catch(() => {});

  const leadIds = extractLeadIds(raw, req.nextUrl);
  if (!leadIds.length) {
    return NextResponse.json({ ok: true, processed: 0, note: 'sin lead id en el payload' });
  }

  const results: unknown[] = [];
  for (const leadId of leadIds) {
    try {
      // skipKommoStatus: el bot ya mueve a Clientes regulares; no reabrir Cargo$.
      const r = await emitCargo(tenant, { kommoLeadId: leadId, source: 'bot', skipKommoStatus: true });
      if (r.skipped === 'already_sent') {
        results.push({ leadId, skipped: 'ya enviado' });
        continue;
      }
      if (!r.ok) {
        results.push({ leadId, error: r.error ?? 'emitCargo failed' });
        continue;
      }
      results.push(r.capi ?? r);
    } catch (e) {
      console.error(`[conversion-event ${tenant.slug}] lead ${leadId}:`, e);
      results.push({ leadId, error: String(e) });
    }
  }

  return NextResponse.json({ ok: true, processed: results.length, results });
}

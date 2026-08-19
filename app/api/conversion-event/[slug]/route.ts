import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { leads, kommoWebhookLog, metaEvents, attributions } from '@/db/schema';
import { getTenantBySlug } from '@/lib/tenants';
import { sendCapiEvent, CAPI_VALUE } from '@/lib/meta';
import { fetchKommoLead, fetchContactPhone, readLeadField, readPhone, contactId, type KommoLead } from '@/lib/kommo';
import type { ResolvedTenant } from '@/lib/types';

// ---------------------------------------------------------------------------
// POST /api/conversion-event/[slug]
//
// Lo llama el BOT "CARGO" del embudo (Kommo salesbot send_hook) cuando se confirma
// una carga. Es la fuente AUTORITATIVA de la conversión de carga: el bot decide
// cuándo, y acto seguido mueve el lead a "Clientes regulares" — por eso NO podemos
// depender del cambio de estado. Dispara CargoCRM<suffix> de forma idempotente.
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

// Reintenta traer el lead: cubre el race/rate-limit cuando las cargas entran en
// ráfaga (Kommo tira 404/429 y sin esto se PERDÍA la carga — el bot dispara este
// webhook y acto seguido mueve el lead, así que la consulta puede fallar).
async function fetchLeadWithRetry(tenant: ResolvedTenant, leadId: number, tries = 4, delayMs = 1200): Promise<KommoLead> {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fetchKommoLead(tenant, leadId);
    } catch (e) {
      lastErr = e;
      if (i < tries - 1) await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}

async function eventExists(tenantId: string, eventId: string): Promise<boolean> {
  const r = await db.query.metaEvents.findFirst({
    where: and(eq(metaEvents.tenantId, tenantId), eq(metaEvents.eventId, eventId), eq(metaEvents.status, 'sent')),
  });
  return !!r;
}

async function userData(tenant: ResolvedTenant, lead: KommoLead) {
  const ud = {
    fbc: readLeadField(lead, tenant.fieldFbc),
    fbp: readLeadField(lead, tenant.fieldFbp),
    fbclid: readLeadField(lead, tenant.fieldFbclid),
    phone: readPhone(lead) as string | null,
  };
  if (!ud.phone) {
    const cId = contactId(lead);
    if (cId) ud.phone = await fetchContactPhone(tenant, cId);
  }
  return ud;
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
      const cargoId = `cargo-${leadId}`;
      if (await eventExists(tenant.id, cargoId)) {
        results.push({ leadId, skipped: 'ya enviado' });
        continue;
      }
      const lead = await fetchLeadWithRetry(tenant, leadId);
      const ud = await userData(tenant, lead);
      let campaign = readLeadField(lead, tenant.fieldUtmCampaign);

      // RECUPERO de atribución: si el lead todavía no tiene utm_campaign / fbc
      // escritos (la atribución del webhook principal puede llegar después de la
      // carga), los tomamos de la atribución matcheada al lead. Sin esto la carga
      // quedaba SIN campaña (y no cuadraba con las conversaciones).
      if (!campaign || !ud.fbc) {
        const [attr] = await db
          .select({ campaignId: attributions.campaignId, fbc: attributions.fbc, fbp: attributions.fbp, fbclid: attributions.fbclid })
          .from(attributions)
          .where(and(eq(attributions.tenantId, tenant.id), eq(attributions.matchedLeadId, leadId)))
          .limit(1);
        if (attr) {
          campaign = campaign ?? attr.campaignId ?? null;
          ud.fbc = ud.fbc ?? attr.fbc;
          ud.fbp = ud.fbp ?? attr.fbp;
          ud.fbclid = ud.fbclid ?? attr.fbclid;
        }
      }

      // Aseguramos el lead espejado (puede no existir si la conversación no pasó
      // por nuestro webhook). Upsert mínimo.
      const [row] = await db
        .insert(leads)
        .values({
          tenantId: tenant.id,
          kommoLeadId: leadId,
          kommoContactId: contactId(lead),
          name: lead.name ?? null,
          phone: ud.phone,
          campaignId: campaign,
          converted: true,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [leads.tenantId, leads.kommoLeadId],
          set: { converted: true, phone: ud.phone, updatedAt: new Date() },
        })
        .returning();

      const r = await sendCapiEvent(tenant, {
        eventName: 'Cargo',
        eventId: cargoId,
        userData: ud,
        customData: {
          campaign_id: campaign ?? undefined,
          internal_event: 'CargoCRM',
          ...CAPI_VALUE,
        },
        leadId: row?.id ?? null,
      });
      results.push(r);
    } catch (e) {
      console.error(`[conversion-event ${tenant.slug}] lead ${leadId}:`, e);
      results.push({ leadId, error: String(e) });
    }
  }

  return NextResponse.json({ ok: true, processed: results.length, results });
}

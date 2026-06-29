import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { leads, kommoWebhookLog, metaEvents, clientSettings } from '@/db/schema';
import { getTenantBySlug } from '@/lib/tenants';
import { sendCapiEvent } from '@/lib/meta';
import { applyAttributionByCode, CODE_REGEX } from '@/lib/attribution';
import { fetchKommoLead, fetchContactPhone, readLeadField, readPhone, contactId, updateLeadFields, type KommoLead } from '@/lib/kommo';
import type { ResolvedTenant } from '@/lib/types';

// CBU robusto: escribe el CBU/Titular del panel en el lead (sin depender del bot).
// Idempotente; solo escribe si el tenant tiene los campos mapeados.
async function writeCbu(tenant: ResolvedTenant, leadId: number) {
  if (tenant.readonly) return; // info-only: nunca escribimos en el lead
  const cbuField = tenant.customFields['cbu_field'];
  const titularField = tenant.customFields['titular_field'];
  if (!cbuField && !titularField) return;
  const [s] = await db.select().from(clientSettings).where(eq(clientSettings.tenantId, tenant.id));
  const fields: Array<{ fieldId: number; value: string }> = [];
  if (cbuField && s?.accountCbu) fields.push({ fieldId: cbuField, value: s.accountCbu });
  if (titularField && s?.accountName) fields.push({ fieldId: titularField, value: s.accountName });
  if (fields.length) await updateLeadFields(tenant, leadId, fields).catch(() => false);
}

// ---------------------------------------------------------------------------
// POST /api/webhooks/kommo/[slug]
//
// Triggers en Kommo (Ajustes -> Webhooks), apuntando a esta URL:
//   - "Lead agregado" / "Etapa del lead cambia" -> conversación / carga
//   - "Mensaje entrante recibido" -> trae el TOKEN del primer mensaje: matchea la
//     atribución (etiquetas campaña+bono, fbclid/utm) y dispara la conversación
//     ENRIQUECIDA. (Recomendado activar este trigger para mejor match.)
//
// event_id determinístico => reintentos idempotentes.
// ---------------------------------------------------------------------------

// Consolidamos todo lo que llega por lead: si pasó por estado, el statusId; si vino
// un mensaje con token, el code.
interface LeadSignal {
  leadId: number;
  statusId?: number;
  code?: string;
}

function parseWebhook(form: URLSearchParams, raw: string): Map<number, LeadSignal> {
  const map = new Map<number, LeadSignal>();
  const get = (k: string) => form.get(k);
  const upsert = (id: number, patch: Partial<LeadSignal>) => {
    const cur = map.get(id) ?? { leadId: id };
    map.set(id, { ...cur, ...patch });
  };

  for (let i = 0; get(`leads[add][${i}][id]`); i++) upsert(Number(get(`leads[add][${i}][id]`)), {});
  for (let i = 0; get(`leads[status][${i}][id]`); i++) {
    upsert(Number(get(`leads[status][${i}][id]`)), {
      statusId: Number(get(`leads[status][${i}][status_id]`)),
    });
  }
  // Mensajes entrantes: el lead puede venir en entity_id / element_id; el token, en
  // el texto. Buscamos el token en todo el body (formato de chat puede variar).
  for (let i = 0; get(`message[add][${i}][id]`); i++) {
    const lid =
      Number(get(`message[add][${i}][entity_id]`)) ||
      Number(get(`message[add][${i}][element_id]`)) ||
      0;
    const text = get(`message[add][${i}][text]`) ?? '';
    const code = (text.match(CODE_REGEX) ?? [])[0];
    if (lid) upsert(lid, code ? { code } : {});
  }
  // Fallback: si hay un token en el body pero no pudimos linkearlo a un lead por
  // los campos de mensaje, y hay un único lead en juego, se lo asignamos.
  if (![...map.values()].some((s) => s.code)) {
    const m = raw.match(CODE_REGEX);
    if (m && map.size === 1) upsert([...map.keys()][0], { code: m[0] });
  }
  return map;
}

async function upsertLead(tenant: ResolvedTenant, lead: KommoLead) {
  const values = {
    tenantId: tenant.id,
    kommoLeadId: lead.id,
    kommoContactId: contactId(lead),
    name: lead.name ?? null,
    phone: readPhone(lead),
    fbclid: readLeadField(lead, tenant.fieldFbclid),
    fbc: readLeadField(lead, tenant.fieldFbc),
    fbp: readLeadField(lead, tenant.fieldFbp),
    campaignId: readLeadField(lead, tenant.fieldUtmCampaign),
    status: lead.status_id ? String(lead.status_id) : null,
    updatedAt: new Date(),
  };
  const [row] = await db
    .insert(leads)
    .values(values)
    .onConflictDoUpdate({ target: [leads.tenantId, leads.kommoLeadId], set: values })
    .returning();
  return row;
}

export async function POST(req: NextRequest, { params }: { params: { slug: string } }) {
  const tenant = await getTenantBySlug(params.slug);
  if (!tenant) return NextResponse.json({ error: 'tenant desconocido' }, { status: 404 });

  const raw = await req.text();
  const form = new URLSearchParams(raw);
  db.insert(kommoWebhookLog).values({ tenantId: tenant.id, body: { raw }, processed: false }).catch(() => {});

  const signals = parseWebhook(form, raw);
  const results: unknown[] = [];

  for (const sig of signals.values()) {
    try {
      const lead = await fetchKommoLead(tenant, sig.leadId);

      // FILTRO: solo el pipeline trackeado del tenant.
      if (tenant.kommoPipelineId && lead.pipeline_id !== tenant.kommoPipelineId) {
        results.push({ leadId: sig.leadId, skipped: 'fuera del pipeline trackeado' });
        continue;
      }

      const row = await upsertLead(tenant, lead);

      // CBU robusto: aseguramos CBU/Titular del panel escritos en el lead (no
      // dependemos del send_hook del bot CBU, que es poco confiable).
      await writeCbu(tenant, sig.leadId);

      // user_data base (teléfono del contacto si falta) + atribución del lead.
      const ud: { fbc: string | null; fbp: string | null; fbclid: string | null; phone: string | null } = {
        fbc: readLeadField(lead, tenant.fieldFbc),
        fbp: readLeadField(lead, tenant.fieldFbp),
        fbclid: readLeadField(lead, tenant.fieldFbclid),
        phone: readPhone(lead),
      };
      if (!ud.phone) {
        const cId = contactId(lead);
        if (cId) ud.phone = await fetchContactPhone(tenant, cId);
      }

      let campaign = readLeadField(lead, tenant.fieldUtmCampaign) ?? undefined;

      // TOKEN: del mensaje (si vino por webhook) o del campo ad_code que el bot WELCOME
      // graba con el primer mensaje. Extraemos el código PBxxxxxx y aplicamos atribución.
      let code = sig.code;
      if (!code && tenant.customFields['ad_code']) {
        const adVal = readLeadField(lead, tenant.customFields['ad_code']);
        const m = adVal?.match(CODE_REGEX);
        if (m) code = m[0];
      }

      // TOKEN: matchea atribución -> etiquetas (campaña+bono) + fbclid/utm en el lead,
      // y enriquece el evento con los datos guardados desde la landing.
      if (code) {
        const attr = await applyAttributionByCode(tenant, sig.leadId, code);
        if (attr) {
          ud.fbclid = ud.fbclid ?? attr.fbclid;
          ud.fbc = ud.fbc ?? attr.fbc;
          ud.fbp = ud.fbp ?? attr.fbp;
          campaign = campaign ?? attr.campaignId ?? undefined;
          results.push({ leadId: sig.leadId, attribution: { campaign: attr.campaignId, bono: attr.bono } });
        }
      }

      // CONVERSACIÓN (idempotente).
      const convId = `conv-${sig.leadId}`;
      if (!(await eventExists(tenant.id, convId))) {
        results.push(
          await sendCapiEvent(tenant, {
            eventName: 'Conversacion',
            eventId: convId,
            userData: ud,
            customData: { campaign_id: campaign, internal_event: 'ConversacionCRM' },
            leadId: row?.id ?? null,
          }),
        );
      }

      // CARGA: cuando entra al estado Cargo$. Miramos el estado del EVENTO (por si un
      // bot lo mueve enseguida) y también el actual. La fuente más confiable sigue
      // siendo /api/conversion-event (bot CARGO), esto es el fallback por estado.
      const cargoId = `cargo-${sig.leadId}`;
      const isCargo = sig.statusId === tenant.statusCargoId || lead.status_id === tenant.statusCargoId;
      if (isCargo && !(await eventExists(tenant.id, cargoId))) {
        results.push(
          await sendCapiEvent(tenant, {
            eventName: 'Cargo',
            eventId: cargoId,
            userData: ud,
            customData: { campaign_id: campaign, internal_event: 'CargoCRM' },
            leadId: row?.id ?? null,
          }),
        );
        if (row) await db.update(leads).set({ converted: true }).where(eq(leads.id, row.id));
      }
    } catch (e) {
      console.error(`[kommo-webhook ${tenant.slug}] lead ${sig.leadId}:`, e);
      results.push({ leadId: sig.leadId, error: String(e) });
    }
  }

  return NextResponse.json({ ok: true, processed: results.length, results });
}

async function eventExists(tenantId: string, eventId: string): Promise<boolean> {
  const r = await db.query.metaEvents.findFirst({
    where: and(eq(metaEvents.tenantId, tenantId), eq(metaEvents.eventId, eventId), eq(metaEvents.status, 'sent')),
  });
  return !!r;
}

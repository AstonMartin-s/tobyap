import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { leads, kommoWebhookLog, clientSettings, attributions } from '@/db/schema';
import { getTenantBySlug } from '@/lib/tenants';
import { sendCapiEvent, eventExists, CAPI_VALUE } from '@/lib/meta';
import { emitCargo } from '@/lib/cargo/emit';
import { applyAttributionByCode, CODE_REGEX } from '@/lib/attribution';
import { fetchKommoLead, fetchContactPhone, readLeadField, readPhone, contactId, updateLeadFields, type KommoLead } from '@/lib/kommo';
import type { ResolvedTenant } from '@/lib/types';
import { syncChatStepFromKommo } from '@/lib/chat/release';
import { assertKommoWebhookSecret } from '@/lib/kommoWebhookAuth';

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

// Reintenta traer el lead: cubre la latencia entre que Kommo dispara el webhook
// y el lead queda disponible en la API (lead recién creado por un mensaje).
async function fetchLeadWithRetry(
  tenant: ResolvedTenant,
  leadId: number,
  tries = 4,
  delayMs = 1200,
) {
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

// GET = health-check. Kommo valida la URL con un GET antes de dejar guardarla
// (si no responde 200 la rechaza como "URL inválida / dirección privada"). Nunca
// procesa eventos: los webhooks reales llegan por POST.
export async function GET(_req: NextRequest, { params }: { params: { slug: string } }) {
  const tenant = await getTenantBySlug(params.slug);
  return NextResponse.json({ ok: true, tenant: tenant ? params.slug : null });
}

export async function POST(req: NextRequest, { params }: { params: { slug: string } }) {
  const tenant = await getTenantBySlug(params.slug);
  if (!tenant) return NextResponse.json({ error: 'tenant desconocido' }, { status: 404 });
  const denied = assertKommoWebhookSecret(req, params.slug);
  if (denied) return denied;

  const raw = await req.text();
  const form = new URLSearchParams(raw);
  db.insert(kommoWebhookLog).values({ tenantId: tenant.id, body: { raw }, processed: false }).catch(() => {});

  const signals = parseWebhook(form, raw);
  const results: unknown[] = [];

  for (const sig of signals.values()) {
    try {
      // Race: cuando entra un mensaje que crea el lead, el webhook del mensaje
      // puede llegar ~1s ANTES de que el lead sea consultable por API. Sin esto,
      // fetchKommoLead tira 404/204 y se pierde el matcheo/etiquetado. Reintentamos.
      const lead = await fetchLeadWithRetry(tenant, sig.leadId);
      const inPipeline = !tenant.kommoPipelineId || lead.pipeline_id === tenant.kommoPipelineId;

      // ===== TOKEN + ATRIBUCIÓN (etiquetas) — SIEMPRE, independiente del pipeline =====
      // El token solo lo tienen los leads que vinieron de NUESTRA landing, así que
      // etiquetar es correcto aunque el lead esté (momentáneamente) en otro pipeline.
      // Esto evita perder el etiquetado cuando el lead entra por el embudo default de
      // WhatsApp y recién después un bot lo mueve al pipeline trackeado.
      let code = sig.code;
      const adField = tenant.customFields['ad_code'];
      const adCurrent = adField ? readLeadField(lead, adField) : null;
      if (!code && adField) {
        const m = adCurrent?.match(CODE_REGEX);
        if (m) code = m[0];
      }
      // RED DE SEGURIDAD: persistimos el token en ad_code (idempotente, nunca readonly).
      if (code && adField && !tenant.readonly && !adCurrent?.match(CODE_REGEX)) {
        await updateLeadFields(tenant, sig.leadId, [{ fieldId: adField, value: code }]).catch(() => {});
      }
      let attr: Awaited<ReturnType<typeof applyAttributionByCode>> = null;
      if (code) {
        attr = await applyAttributionByCode(tenant, sig.leadId, code);
        if (attr) results.push({ leadId: sig.leadId, attribution: { campaign: attr.campaignId, bono: attr.bono } });
      }

      // El resto (espejado, CBU y eventos CAPI) solo para el pipeline trackeado.
      if (!inPipeline) {
        results.push({ leadId: sig.leadId, skipped: 'fuera del pipeline (etiquetado igual aplicado)' });
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
      // Enriquecemos el evento con la atribución ya resuelta arriba.
      if (attr) {
        ud.fbclid = ud.fbclid ?? attr.fbclid;
        ud.fbc = ud.fbc ?? attr.fbc;
        ud.fbp = ud.fbp ?? attr.fbp;
        campaign = campaign ?? attr.campaignId ?? undefined;
      }

      // RECUPERO de atribución: si este webhook no trajo el token (ej. llegó por
      // "lead agregado" o cambio de estado), pero el token YA se procesó en un
      // webhook anterior, la atribución quedó matcheada al lead. La leemos para
      // no disparar eventos sin campaign/fbc.
      if (!campaign || !ud.fbc) {
        const [prev] = await db
          .select({
            campaignId: attributions.campaignId,
            fbc: attributions.fbc,
            fbp: attributions.fbp,
            fbclid: attributions.fbclid,
          })
          .from(attributions)
          .where(and(eq(attributions.tenantId, tenant.id), eq(attributions.matchedLeadId, sig.leadId)))
          .limit(1);
        if (prev) {
          campaign = campaign ?? prev.campaignId ?? undefined;
          ud.fbc = ud.fbc ?? prev.fbc;
          ud.fbp = ud.fbp ?? prev.fbp;
          ud.fbclid = ud.fbclid ?? prev.fbclid;
        }
      }

      // CONVERSACIÓN (idempotente). Solo la disparamos cuando ya tenemos la
      // atribución resuelta (campaign o fbc): sin fbc, Meta no puede atribuirla a
      // la campaña (llega al pixel pero no a la cuenta publicitaria) y sin campaign
      // se rompe el tracker. Si todavía no hay atribución, DIFERIMOS: no la
      // quemamos; el webhook del mensaje con el token la disparará enriquecida.
      // Excepción: si ya hubo Cargo, forzamos (hubo conversación sí o sí).
      const convId = `conv-${sig.leadId}`;
      if (!(await eventExists(tenant.id, convId))) {
        const hasAttribution = !!(campaign || ud.fbc);
        const cargoAlready = await eventExists(tenant.id, `cargo-${sig.leadId}`);
        if (hasAttribution || cargoAlready) {
          results.push(
            await sendCapiEvent(tenant, {
              eventName: 'Conversacion',
              eventId: convId,
              userData: ud,
              customData: { campaign_id: campaign, internal_event: 'ConversacionCRM', ...CAPI_VALUE },
              leadId: row?.id ?? null,
            }),
          );
        } else {
          results.push({ leadId: sig.leadId, deferred: 'conversacion: atribución aún no resuelta' });
        }
      }

      // CARGA: fallback por etapa Cargo$. Autoridad = bot /api/conversion-event.
      // emitCargo es idempotente (mismo event_id que bot/panel) y libera el chat.
      const isCargo = sig.statusId === tenant.statusCargoId || lead.status_id === tenant.statusCargoId;
      if (isCargo) {
        results.push(
          await emitCargo(tenant, {
            kommoLeadId: sig.leadId,
            source: 'webhook',
            userData: ud,
            campaign: campaign ?? null,
            leadRowId: row?.id ?? null,
            skipKommoStatus: true,
          }),
        );
      }
      // KOMMO MANDA: reflejamos en el panel cualquier etapa de resultado que el
      // empleado haya movido en Kommo (Cargo$ / No Cargo / Revisar imagen).
      const statusNow = sig.statusId ?? lead.status_id;
      syncChatStepFromKommo(tenant, sig.leadId, statusNow).catch(() => {});
    } catch (e) {
      console.error(`[kommo-webhook ${tenant.slug}] lead ${sig.leadId}:`, e);
      results.push({ leadId: sig.leadId, error: String(e) });
    }
  }

  return NextResponse.json({ ok: true, processed: results.length, results });
}

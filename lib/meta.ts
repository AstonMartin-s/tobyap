import crypto from 'crypto';
import { and, eq, gt, inArray, sql } from 'drizzle-orm';
import { db } from '@/db';
import { metaEvents, tenants } from '@/db/schema';
import { decryptOptional } from '@/lib/crypto';
import { NICHE_EVENTS, type EventSlot } from '@/lib/niche';
import type { ResolvedTenant } from '@/lib/types';

// ---------------------------------------------------------------------------
// Meta Conversions API (CAPI) — envío server-side por tenant.
// Eventos: ConversacionCRM<suffix> (inicia chat) y CargoCRM<suffix> (compra).
// Regla: la atribución (fbc/fbp) se LEE del lead, no se recalcula.
// El event_id es determinístico => reintentos idempotentes (dedup en Meta).
// ---------------------------------------------------------------------------

const GRAPH_VERSION = 'v21.0';

// Valor nominal por evento (para reporte de valor en Meta y consistencia con el
// resto de los CRMs). No es el valor real del depósito; es un valor fijo para
// poblar value/currency. Se puede tunear por evento acá.
export const CAPI_VALUE = { value: 1, currency: 'USD' } as const;

// value/currency para el evento Conversacion. Si el tenant tiene un valor
// esperado por chat configurado (customFields.conversation_value_ars), lo
// mandamos en ARS; si no, cae al placeholder CAPI_VALUE. Así Meta puede
// optimizar campañas por valor también sobre la conversación.
export function conversationValue(tenant: ResolvedTenant): { value: number; currency: string } {
  if (tenant.conversationValue != null && tenant.conversationValue > 0) {
    return { value: tenant.conversationValue, currency: 'ARS' };
  }
  return { ...CAPI_VALUE };
}

export type BaseEventName = 'Conversacion' | 'Cargo';

export interface CapiUserData {
  phone?: string | null;
  email?: string | null;
  fbc?: string | null;
  fbp?: string | null;
  fbclid?: string | null; // fallback para construir fbc
  clientIp?: string | null;
  userAgent?: string | null;
  externalId?: string | null; // ID estable por usuario; si falta, se deriva del teléfono
}

// País por defecto de nuestros clientes (AR). Meta espera el código ISO-2 en
// minúscula y hasheado. Suma señal de matching sin pedir dato nuevo.
const DEFAULT_COUNTRY = 'ar';

export interface SendCapiInput {
  eventName: BaseEventName;
  eventId: string; // determinístico, ej "conv-<leadId>" / "cargo-<leadId>"
  userData: CapiUserData;
  customData?: Record<string, unknown>;
  eventSourceUrl?: string | null;
  actionSource?: 'website' | 'business_messaging' | 'system_generated';
  leadId?: string | null; // uuid interno para auditoría
  // Fecha del evento (event_time de Meta + sentAt en la DB). Default: ahora.
  // Se usa para recuperar conversiones pasadas con su fecha real.
  eventTime?: Date;
}

// ---- Helpers de hashing (Meta exige SHA-256, lowercase, trim) -------------

function sha256(value?: string | null): string | undefined {
  if (!value) return undefined;
  const norm = value.trim().toLowerCase();
  if (!norm) return undefined;
  return crypto.createHash('sha256').update(norm).digest('hex');
}

function hashPhone(phone?: string | null): string | undefined {
  if (!phone) return undefined;
  const digits = phone.replace(/\D/g, ''); // solo dígitos, con código de país
  return digits ? crypto.createHash('sha256').update(digits).digest('hex') : undefined;
}

// fbc preferente = el capturado en la landing; fallback desde fbclid.
function resolveFbc(u: CapiUserData): string | undefined {
  if (u.fbc) return u.fbc;
  if (u.fbclid) return `fb.1.${Date.now()}.${u.fbclid}`;
  return undefined;
}

function buildUserData(u: CapiUserData) {
  const ud: Record<string, unknown> = {};
  const fbc = resolveFbc(u);
  if (fbc) ud.fbc = fbc;
  if (u.fbp) ud.fbp = u.fbp;
  const phoneDigits = u.phone ? u.phone.replace(/\D/g, '') : '';
  const ph = hashPhone(u.phone);
  if (ph) ud.ph = [ph];
  const em = sha256(u.email);
  if (em) ud.em = [em];
  // external_id: ID estable por usuario. Si no viene explícito, lo derivamos del
  // teléfono (hash). Mejora la calidad de coincidencias sin pedir datos nuevos.
  const externalRaw = u.externalId ?? (phoneDigits || null);
  const extId = sha256(externalRaw);
  if (extId) ud.external_id = [extId];
  // country (ISO-2, minúscula, hasheado). Todos nuestros clientes son AR.
  const country = sha256(DEFAULT_COUNTRY);
  if (country) ud.country = [country];
  if (u.clientIp) ud.client_ip_address = u.clientIp;
  if (u.userAgent) ud.client_user_agent = u.userAgent;
  return ud;
}

// Nombre final del evento según el nicho del tenant.
//  - circo:  "Conversacion" + "30" -> "ConversacionCRM30" (comportamiento actual).
//  - tienda: eventos estándar de Meta -> "Contact" / "Purchase" (sin sufijo).
// Las dos bases lógicas ('Conversacion' | 'Cargo') mapean a las ranuras
// conversation/conversion del vocabulario de nicho (lib/niche.ts).
export function fullEventName(base: BaseEventName, tenant: ResolvedTenant): string {
  const slot: EventSlot = base === 'Conversacion' ? 'conversation' : 'conversion';
  const ev = NICHE_EVENTS[tenant.niche]?.[slot];
  if (!ev) return `${base}CRM${tenant.eventSuffix}`;
  return ev.standard ? ev.base : `${ev.base}CRM${tenant.eventSuffix}`;
}

// ---- Envío ----------------------------------------------------------------

export interface CapiResult {
  ok: boolean;
  status: number;
  eventId: string;
  eventName: string;
  body: unknown;
}

// Idempotencia CAPI: un event_id ya 'sent' no se reenvía (Meta también dedup).
export async function eventExists(tenantId: string, eventId: string): Promise<boolean> {
  const r = await db.query.metaEvents.findFirst({
    where: and(eq(metaEvents.tenantId, tenantId), eq(metaEvents.eventId, eventId), eq(metaEvents.status, 'sent')),
  });
  return !!r;
}

export async function eventExistsAny(tenantId: string, eventIds: string[]): Promise<boolean> {
  if (!eventIds.length) return false;
  const r = await db.query.metaEvents.findFirst({
    where: and(eq(metaEvents.tenantId, tenantId), inArray(metaEvents.eventId, eventIds), eq(metaEvents.status, 'sent')),
  });
  return !!r;
}

export async function sendCapiEvent(
  tenant: ResolvedTenant,
  input: SendCapiInput,
): Promise<CapiResult> {
  const eventName = fullEventName(input.eventName, tenant);

  if (!tenant.metaPixelId || !tenant.metaCapiToken) {
    throw new Error(`Tenant ${tenant.slug} sin pixel/token de Meta configurado`);
  }

  // PAYBOT usa action_source 'website'. Si se usa 'business_messaging', Meta exige
  // además messaging_channel (whatsapp/messenger/instagram).
  const actionSource = input.actionSource ?? 'website';

  const event = {
    event_name: eventName,
    event_time: Math.floor((input.eventTime ?? new Date()).getTime() / 1000),
    event_id: input.eventId,
    action_source: actionSource,
    ...(actionSource === 'business_messaging' ? { messaging_channel: 'whatsapp' } : {}),
    ...(input.eventSourceUrl ? { event_source_url: input.eventSourceUrl } : {}),
    user_data: buildUserData(input.userData),
    custom_data: input.customData ?? {},
  };

  const payload: Record<string, unknown> = {
    data: [event],
    access_token: tenant.metaCapiToken,
  };
  if (process.env.META_TEST_EVENT_CODE) {
    payload.test_event_code = process.env.META_TEST_EVENT_CODE;
  }

  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${tenant.metaPixelId}/events`;

  let res: Response;
  let body: unknown;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    body = await res.json().catch(() => ({}));
  } catch (e) {
    // Persistir el fallo de red para reintento, sin romper el flujo.
    await persistEvent(tenant, input, eventName, event, { error: String(e) }, 'failed');
    return { ok: false, status: 0, eventId: input.eventId, eventName, body: { error: String(e) } };
  }

  const status = res.ok ? 'sent' : 'failed';
  await persistEvent(tenant, input, eventName, event, body, status);

  return { ok: res.ok, status: res.status, eventId: input.eventId, eventName, body };
}

// ---------------------------------------------------------------------------
// Reintento de eventos fallidos.
// Un fallo de red/transitorio de Meta deja el evento en status 'failed' con su
// payload guardado. Esto los re-envía (mismo event_id => Meta deduplica). Lo
// dispara un cron: sin esto, una conversión perdida por un hipo de red no se
// recupera nunca.
// ---------------------------------------------------------------------------
export async function retryFailedEvents(opts?: { maxAgeHours?: number; limit?: number }) {
  const maxAgeHours = opts?.maxAgeHours ?? 48; // no reintentar indefinidamente
  const limit = opts?.limit ?? 100;
  const cutoff = new Date(Date.now() - maxAgeHours * 3600_000);

  const rows = await db
    .select({
      id: metaEvents.id,
      tenantId: metaEvents.tenantId,
      eventId: metaEvents.eventId,
      payload: metaEvents.payload,
      pixelId: tenants.metaPixelId,
      token: tenants.metaCapiToken,
    })
    .from(metaEvents)
    .innerJoin(tenants, eq(tenants.id, metaEvents.tenantId))
    .where(and(eq(metaEvents.status, 'failed'), gt(metaEvents.createdAt, cutoff)))
    .limit(limit);

  let sent = 0;
  let stillFailed = 0;
  for (const r of rows) {
    const token = decryptOptional(r.token);
    if (!r.payload || !r.pixelId || !token) continue;
    try {
      const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${r.pixelId}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: [r.payload], access_token: token }),
      });
      const body = await res.json().catch(() => ({}));
      const ok = res.ok;
      await db
        .update(metaEvents)
        .set({ status: ok ? 'sent' : 'failed', success: ok, response: body, sentAt: ok ? new Date() : null })
        .where(eq(metaEvents.id, r.id));
      ok ? sent++ : stillFailed++;
    } catch {
      stillFailed++;
    }
  }
  return { scanned: rows.length, sent, stillFailed };
}

// Auditoría + idempotencia. El unique(tenant_id, event_id) evita duplicados:
// si un reintento llega con el mismo event_id, hacemos onConflictDoNothing.
async function persistEvent(
  tenant: ResolvedTenant,
  input: SendCapiInput,
  eventName: string,
  payload: unknown,
  response: unknown,
  status: 'sent' | 'failed' | 'pending',
) {
  try {
    const eventType = input.eventName === 'Conversacion' ? 'conversacion' : 'cargo';
    const campaignId = (input.customData?.campaign_id as string) ?? null;
    const sentAt = status === 'sent' ? (input.eventTime ?? new Date()) : null;
    await db
      .insert(metaEvents)
      .values({
        tenantId: tenant.id,
        leadId: input.leadId ?? null,
        eventName,
        eventId: input.eventId,
        // eventType alimenta los reportes admin (conversacion / cargo / redirect).
        eventType,
        campaignId,
        payload: payload as object,
        response: response as object,
        status,
        success: status === 'sent',
        sentAt,
      })
      // Si ya existía (p. ej. un intento fallido), lo actualizamos: así un reintento
      // exitoso queda reflejado como 'sent' en vez de quedar pegado en 'failed'.
      .onConflictDoUpdate({
        target: [metaEvents.tenantId, metaEvents.eventId],
        set: { payload: payload as object, response: response as object, status, success: status === 'sent', sentAt },
      });
  } catch (e) {
    console.error('[meta] no se pudo persistir el evento:', e);
  }
}

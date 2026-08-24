import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { attributions, chatSessions, leads } from '@/db/schema';
import { sendCapiEvent, eventExistsAny, CAPI_VALUE, type CapiResult, type CapiUserData } from '@/lib/meta';
import { fetchKommoLead, fetchContactPhone, readLeadField, readPhone, contactId, updateLeadStatus, type KommoLead } from '@/lib/kommo';
import { releaseChatOnCargo } from '@/lib/chat/release';
import type { ResolvedTenant } from '@/lib/types';

// ---------------------------------------------------------------------------
// emitCargo — una sola atribución CargoCRM por lead, sin importar el origen.
//
// Callsites: webhook Kommo (etapa Cargo$), bot POST /api/conversion-event,
// panel POST /api/convert, panel chats op:approve.
//
// event_id: cargo-{kommoLeadId} (preferido) | cargo-session-{sessionKey} (chat
// sin lead). Idempotente contra ambos alias para no duplicar si el lead llega
// después. sendCapiEvent persiste meta_events (unique tenant+event_id).
//
// Bot CARGO mueve el lead a Clientes regulares: NUNCA reabrir Cargo$ desde bot.
// Webhook ya está en Cargo$: no re-PATCHear. Panel approve ya acredita el chat
// y mueve Kommo: skipChatRelease + skipKommoStatus.
// ---------------------------------------------------------------------------

export type CargoSource = 'webhook' | 'bot' | 'convert' | 'panel';

export interface EmitCargoInput {
  kommoLeadId?: number | null;
  sessionKey?: string | null;
  source: CargoSource;
  operator?: string | null;
  userData?: CapiUserData;
  campaign?: string | null;
  leadRowId?: string | null;
  eventSourceUrl?: string | null;
  value?: number;
  currency?: string;
  skipKommoStatus?: boolean;
  skipChatRelease?: boolean;
}

export interface EmitCargoResult {
  ok: boolean;
  eventId: string;
  source: CargoSource;
  skipped?: 'already_sent' | 'no_id';
  error?: string;
  capi?: CapiResult;
  chatReleased?: boolean;
  kommoStatusUpdated?: boolean;
}

export function panelApproveEmitsCargo(): boolean {
  const v = process.env.EMIT_CARGO_FROM_PANEL;
  return v !== '0' && v !== 'false';
}

export function cargoEventId(opts: { kommoLeadId?: number | null; sessionKey?: string | null }): string {
  if (opts.kommoLeadId) return `cargo-${opts.kommoLeadId}`;
  if (opts.sessionKey) return `cargo-session-${opts.sessionKey}`;
  return '';
}

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

async function resolveIds(
  tenantId: string,
  input: EmitCargoInput,
): Promise<{ kommoLeadId: number | null; sessionKey: string | null; eventId: string; aliasIds: string[] }> {
  let kommoLeadId = input.kommoLeadId ?? null;
  let sessionKey = input.sessionKey ?? null;

  if (sessionKey && !kommoLeadId) {
    const [s] = await db
      .select({ kommoLeadId: chatSessions.kommoLeadId })
      .from(chatSessions)
      .where(and(eq(chatSessions.tenantId, tenantId), eq(chatSessions.sessionKey, sessionKey)))
      .limit(1);
    if (s?.kommoLeadId) kommoLeadId = s.kommoLeadId;
  }
  if (kommoLeadId && !sessionKey) {
    const [s] = await db
      .select({ sessionKey: chatSessions.sessionKey })
      .from(chatSessions)
      .where(and(eq(chatSessions.tenantId, tenantId), eq(chatSessions.kommoLeadId, kommoLeadId)))
      .limit(1);
    if (s?.sessionKey) sessionKey = s.sessionKey;
  }

  const eventId = cargoEventId({ kommoLeadId, sessionKey });
  const aliasIds = [
    kommoLeadId ? `cargo-${kommoLeadId}` : null,
    sessionKey ? `cargo-session-${sessionKey}` : null,
  ].filter((x): x is string => !!x);

  return { kommoLeadId, sessionKey, eventId, aliasIds };
}

async function attrByLead(tenantId: string, leadId: number) {
  const [row] = await db
    .select({
      campaignId: attributions.campaignId,
      fbc: attributions.fbc,
      fbp: attributions.fbp,
      fbclid: attributions.fbclid,
      eventSourceUrl: attributions.eventSourceUrl,
    })
    .from(attributions)
    .where(and(eq(attributions.tenantId, tenantId), eq(attributions.matchedLeadId, leadId)))
    .limit(1);
  return row ?? null;
}

async function attrByCode(tenantId: string, code: string) {
  const [row] = await db
    .select({
      campaignId: attributions.campaignId,
      fbc: attributions.fbc,
      fbp: attributions.fbp,
      fbclid: attributions.fbclid,
      eventSourceUrl: attributions.eventSourceUrl,
    })
    .from(attributions)
    .where(and(eq(attributions.tenantId, tenantId), eq(attributions.code, code)))
    .limit(1);
  return row ?? null;
}

function mergeAttr(
  ud: CapiUserData,
  campaign: string | null | undefined,
  eventSourceUrl: string | null | undefined,
  attr: { campaignId: string | null; fbc: string | null; fbp: string | null; fbclid: string | null; eventSourceUrl: string | null } | null,
) {
  if (!attr) return { ud, campaign, eventSourceUrl };
  return {
    ud: {
      ...ud,
      fbc: ud.fbc ?? attr.fbc,
      fbp: ud.fbp ?? attr.fbp,
      fbclid: ud.fbclid ?? attr.fbclid,
    },
    campaign: campaign ?? attr.campaignId ?? null,
    eventSourceUrl: eventSourceUrl ?? attr.eventSourceUrl ?? null,
  };
}

async function resolveContext(
  tenant: ResolvedTenant,
  ids: { kommoLeadId: number | null; sessionKey: string | null },
  input: EmitCargoInput,
): Promise<{ userData: CapiUserData; campaign: string | null; leadRowId: string | null; eventSourceUrl: string | null }> {
  let userData: CapiUserData = { ...(input.userData ?? {}) };
  let campaign: string | null = input.campaign ?? null;
  let leadRowId: string | null = input.leadRowId ?? null;
  let eventSourceUrl: string | null = input.eventSourceUrl ?? null;

  if (ids.kommoLeadId && (!input.userData || !campaign || !userData.fbc)) {
    if (!input.userData) {
      const lead = await fetchLeadWithRetry(tenant, ids.kommoLeadId);
      userData = {
        fbc: readLeadField(lead, tenant.fieldFbc),
        fbp: readLeadField(lead, tenant.fieldFbp),
        fbclid: readLeadField(lead, tenant.fieldFbclid),
        phone: readPhone(lead),
      };
      if (!userData.phone) {
        const cId = contactId(lead);
        if (cId) userData.phone = await fetchContactPhone(tenant, cId);
      }
      campaign = campaign ?? readLeadField(lead, tenant.fieldUtmCampaign);

      const [row] = await db
        .insert(leads)
        .values({
          tenantId: tenant.id,
          kommoLeadId: ids.kommoLeadId,
          kommoContactId: contactId(lead),
          name: lead.name ?? null,
          phone: userData.phone ?? null,
          campaignId: campaign,
          converted: true,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [leads.tenantId, leads.kommoLeadId],
          set: { converted: true, phone: userData.phone ?? null, updatedAt: new Date() },
        })
        .returning({ id: leads.id });
      leadRowId = leadRowId ?? row?.id ?? null;
    }

    if (!campaign || !userData.fbc) {
      const merged = mergeAttr(userData, campaign, eventSourceUrl, await attrByLead(tenant.id, ids.kommoLeadId));
      userData = merged.ud;
      campaign = merged.campaign ?? null;
      eventSourceUrl = merged.eventSourceUrl ?? null;
    }
  }

  if (ids.sessionKey && (!userData.phone || !campaign || !userData.fbc)) {
    const [s] = await db
      .select()
      .from(chatSessions)
      .where(and(eq(chatSessions.tenantId, tenant.id), eq(chatSessions.sessionKey, ids.sessionKey)))
      .limit(1);
    if (s) {
      userData.phone = userData.phone ?? s.phone;
      campaign = campaign ?? s.campaign ?? null;
      if (s.token && (!campaign || !userData.fbc)) {
        const merged = mergeAttr(userData, campaign, eventSourceUrl, await attrByCode(tenant.id, s.token));
        userData = merged.ud;
        campaign = merged.campaign ?? null;
        eventSourceUrl = merged.eventSourceUrl ?? null;
      }
    }
  }

  if (ids.kommoLeadId && !leadRowId) {
    const existing = await db.query.leads.findFirst({
      where: and(eq(leads.tenantId, tenant.id), eq(leads.kommoLeadId, ids.kommoLeadId)),
    });
    leadRowId = existing?.id ?? null;
    if (existing) {
      userData.fbc = userData.fbc ?? existing.fbc;
      userData.fbp = userData.fbp ?? existing.fbp;
      userData.fbclid = userData.fbclid ?? existing.fbclid;
      userData.phone = userData.phone ?? existing.phone;
      campaign = campaign ?? existing.campaignId;
      eventSourceUrl = eventSourceUrl ?? existing.eventSourceUrl;
    }
  }

  return { userData, campaign, leadRowId, eventSourceUrl };
}

async function markConverted(tenantId: string, kommoLeadId: number | null, leadRowId: string | null) {
  if (leadRowId) {
    await db.update(leads).set({ converted: true, updatedAt: new Date() }).where(eq(leads.id, leadRowId));
    return;
  }
  if (kommoLeadId) {
    await db
      .update(leads)
      .set({ converted: true, updatedAt: new Date() })
      .where(and(eq(leads.tenantId, tenantId), eq(leads.kommoLeadId, kommoLeadId)));
  }
}

export async function emitCargo(tenant: ResolvedTenant, input: EmitCargoInput): Promise<EmitCargoResult> {
  const ids = await resolveIds(tenant.id, input);
  if (!ids.eventId) {
    return { ok: false, eventId: '', source: input.source, skipped: 'no_id', error: 'kommoLeadId o sessionKey requerido' };
  }

  const already = await eventExistsAny(tenant.id, ids.aliasIds);
  const sideEffects = async (): Promise<Pick<EmitCargoResult, 'chatReleased' | 'kommoStatusUpdated'>> => {
    let chatReleased = false;
    let kommoStatusUpdated = false;
    if (!input.skipChatRelease && ids.kommoLeadId) {
      chatReleased = await releaseChatOnCargo(tenant, ids.kommoLeadId);
    }
    if (!input.skipKommoStatus && !tenant.readonly && ids.kommoLeadId && tenant.statusCargoId) {
      try {
        const lead = await fetchKommoLead(tenant, ids.kommoLeadId);
        if (lead.status_id !== tenant.statusCargoId) {
          kommoStatusUpdated = await updateLeadStatus(tenant, ids.kommoLeadId, tenant.statusCargoId);
        }
      } catch {
        /* best-effort */
      }
    }
    return { chatReleased, kommoStatusUpdated };
  };

  if (already) {
    const extra = await sideEffects();
    console.log(`[emitCargo ${tenant.slug}] skip already_sent`, { eventId: ids.eventId, source: input.source });
    await markConverted(tenant.id, ids.kommoLeadId, input.leadRowId ?? null);
    return { ok: true, eventId: ids.eventId, source: input.source, skipped: 'already_sent', ...extra };
  }

  try {
    const ctx = await resolveContext(tenant, ids, input);
    const customData: Record<string, unknown> = {
      campaign_id: ctx.campaign ?? undefined,
      internal_event: 'CargoCRM',
      cargo_source: input.source,
      ...(input.operator ? { cargo_operator: input.operator } : {}),
      // value/currency del Cargo. Si hay monto real cargado (ARS), lo mandamos
      // para que Meta pueda optimizar campañas por VALOR de cargo. Si no lo
      // conocemos, usamos un placeholder pero SIEMPRE en ARS: mezclar monedas
      // en un mismo evento rompe la optimización por valor.
      ...(input.value != null
        ? { value: input.value, currency: input.currency ?? 'ARS' }
        : { value: CAPI_VALUE.value, currency: 'ARS' }),
    };

    const capi = await sendCapiEvent(tenant, {
      eventName: 'Cargo',
      eventId: ids.eventId,
      userData: ctx.userData,
      customData,
      eventSourceUrl: ctx.eventSourceUrl,
      leadId: ctx.leadRowId,
    });

    await markConverted(tenant.id, ids.kommoLeadId, ctx.leadRowId);
    const extra = await sideEffects();
    console.log(`[emitCargo ${tenant.slug}]`, {
      eventId: ids.eventId,
      source: input.source,
      ok: capi.ok,
      status: capi.status,
    });
    return { ok: capi.ok, eventId: ids.eventId, source: input.source, capi, ...extra };
  } catch (e) {
    console.error(`[emitCargo ${tenant.slug}]`, e);
    return { ok: false, eventId: ids.eventId, source: input.source, error: String(e) };
  }
}

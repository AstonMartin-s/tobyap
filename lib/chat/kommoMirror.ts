import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { attributions } from '@/db/schema';
import { resolveBono } from '@/lib/attribution';
import { kfetch } from '@/lib/kommo-throttle';
import type { ResolvedTenant } from '@/lib/types';

// Espejo a Kommo (Adaptador B). Todo best-effort: si falla, el chat sigue.
// Crea el lead+contacto con etiquetas + custom fields en UNA sola llamada
// (antes eran 5-6 llamadas sueltas que saturaban el rate-limit de Kommo en
// picos de tráfico). Todas las llamadas pasan por el throttle global (kfetch).

function base(tenant: ResolvedTenant) {
  return { url: `https://${tenant.kommoSubdomain}.kommo.com/api/v4`, H: { Authorization: `Bearer ${tenant.kommoToken}`, 'Content-Type': 'application/json' } };
}

export async function createChatLead(
  tenant: ResolvedTenant,
  input: { phone: string; name?: string | null; token?: string | null; campaign?: string | null; ccpp?: string | null },
): Promise<number | null> {
  if (!tenant.kommoSubdomain || !tenant.kommoToken) return null;
  const { url, H } = base(tenant);
  const leadName = input.name?.trim() || `Web ${input.phone.slice(-4)}`;
  const cf = tenant.customFields;

  // Atribución del token de la landing — desde la DB, SIN llamar a Kommo.
  const attr = input.token
    ? await db.query.attributions.findFirst({ where: and(eq(attributions.tenantId, tenant.id), eq(attributions.code, input.token)) })
    : null;

  const campaign = attr?.campaignId ?? input.campaign ?? null;
  const bono = attr?.bono ?? resolveBono(tenant, input.ccpp ?? attr?.ccpp ?? null);

  // Custom fields (todo en el mismo create).
  const cfields: Array<{ field_id: number; values: Array<{ value: string }> }> = [];
  if (cf['ad_code'] && input.token) cfields.push({ field_id: cf['ad_code'], values: [{ value: input.token }] });
  if (tenant.fieldUtmCampaign && campaign) cfields.push({ field_id: tenant.fieldUtmCampaign, values: [{ value: campaign }] });
  if (cf['fbclid'] && attr?.fbclid) cfields.push({ field_id: cf['fbclid'], values: [{ value: attr.fbclid }] });
  if (cf['utm_source'] && attr?.utmSource) cfields.push({ field_id: cf['utm_source'], values: [{ value: attr.utmSource }] });
  if (cf['utm_content'] && attr?.utmContent) cfields.push({ field_id: cf['utm_content'], values: [{ value: attr.utmContent }] });

  // Etiquetas (mismas que el flujo de WhatsApp): origen + campaña + bono.
  const tags: Array<{ name: string }> = [{ name: 'Chat Web' }];
  if (campaign) tags.push({ name: campaign });
  if (bono) tags.push({ name: bono });

  const body = [{
    name: leadName,
    ...(tenant.kommoPipelineId ? { pipeline_id: tenant.kommoPipelineId } : {}),
    ...(cfields.length ? { custom_fields_values: cfields } : {}),
    _embedded: {
      tags,
      contacts: [{
        first_name: leadName,
        custom_fields_values: [{ field_code: 'PHONE', values: [{ value: input.phone, enum_code: 'WORK' }] }],
      }],
    },
  }];

  // Una sola llamada (kfetch ya pacea + reintenta 429/5xx). Loguea el error real.
  const r = await kfetch(`${url}/leads/complex`, { method: 'POST', headers: H, body: JSON.stringify(body) });
  const text = await r.text().catch(() => '');
  if (!r.ok) {
    console.error(`[chat createChatLead] ${tenant.slug} HTTP ${r.status}: ${text.slice(0, 300)}`);
    return null;
  }
  let leadId: number | null = null;
  try {
    const j = JSON.parse(text) as Array<{ id?: number }>;
    leadId = Array.isArray(j) ? (j[0]?.id ?? null) : null;
  } catch { /* respuesta inesperada */ }

  // Marcamos la atribución como matcheada (DB, sin Kommo) para que el evento de
  // Cargo del webhook recupere fbc/fbp.
  if (leadId && attr && !attr.matchedLeadId) {
    await db.update(attributions).set({ matchedLeadId: leadId, matchedAt: new Date() }).where(eq(attributions.id, attr.id)).catch(() => {});
  }
  return leadId;
}

export async function addLeadNote(tenant: ResolvedTenant, leadId: number, text: string): Promise<void> {
  if (!tenant.kommoSubdomain || !tenant.kommoToken || !leadId) return;
  const { url, H } = base(tenant);
  const body = [{ entity_id: leadId, note_type: 'common', params: { text } }];
  try {
    await kfetch(`${url}/leads/notes`, { method: 'POST', headers: H, body: JSON.stringify(body) });
  } catch {
    /* best-effort */
  }
}

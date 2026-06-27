import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { leads, kommoWebhookLog } from '@/db/schema';
import { getTenantBySlug } from '@/lib/tenants';
import { sendCapiEvent } from '@/lib/meta';
import { fetchKommoLead, readLeadField, readPhone, contactId, type KommoLead } from '@/lib/kommo';
import type { ResolvedTenant } from '@/lib/types';

// ---------------------------------------------------------------------------
// POST /api/webhooks/kommo/[slug]
//
// Triggers a configurar en Kommo (Ajustes -> Webhooks), apuntando a esta URL:
//   - "Lead agregado"        -> dispara ConversacionCRM<suffix>
//   - "Etapa del lead cambia"-> si pasa a status_cargo, dispara CargoCRM<suffix>
//
// Devuelve 200 rápido; los errores por evento quedan logueados (Kommo reintenta,
// y el event_id determinístico hace que el reintento sea idempotente).
// ---------------------------------------------------------------------------

interface KommoEvent {
  type: 'add' | 'status';
  leadId: number;
  statusId?: number;
}

function parseWebhook(form: URLSearchParams): KommoEvent[] {
  const events: KommoEvent[] = [];
  const get = (k: string) => form.get(k);

  for (let i = 0; get(`leads[add][${i}][id]`); i++) {
    events.push({ type: 'add', leadId: Number(get(`leads[add][${i}][id]`)) });
  }
  for (let i = 0; get(`leads[status][${i}][id]`); i++) {
    events.push({
      type: 'status',
      leadId: Number(get(`leads[status][${i}][id]`)),
      statusId: Number(get(`leads[status][${i}][status_id]`)),
    });
  }
  return events;
}

// Upsert del lead espejado, devolviendo el uuid interno.
async function upsertLead(tenant: ResolvedTenant, lead: KommoLead, sourceUrl: string | null) {
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
    eventSourceUrl: sourceUrl,
    status: lead.status_id ? String(lead.status_id) : null,
    updatedAt: new Date(),
  };

  const [row] = await db
    .insert(leads)
    .values(values)
    .onConflictDoUpdate({
      target: [leads.tenantId, leads.kommoLeadId],
      set: values,
    })
    .returning();
  return row;
}

function buildUserData(tenant: ResolvedTenant, lead: KommoLead) {
  return {
    fbc: readLeadField(lead, tenant.fieldFbc),
    fbp: readLeadField(lead, tenant.fieldFbp),
    fbclid: readLeadField(lead, tenant.fieldFbclid),
    phone: readPhone(lead),
  };
}

export async function POST(req: NextRequest, { params }: { params: { slug: string } }) {
  const tenant = await getTenantBySlug(params.slug);
  if (!tenant) return NextResponse.json({ error: 'tenant desconocido' }, { status: 404 });

  const raw = await req.text();
  const form = new URLSearchParams(raw);

  // Log crudo (best-effort, no bloquea).
  db.insert(kommoWebhookLog)
    .values({ tenantId: tenant.id, body: { raw }, processed: false })
    .catch((e) => console.error('[webhook] no se pudo loguear:', e));

  const events = parseWebhook(form);
  const results: unknown[] = [];

  for (const ev of events) {
    try {
      const lead = await fetchKommoLead(tenant, ev.leadId);
      const row = await upsertLead(tenant, lead, null);
      const ud = buildUserData(tenant, lead);

      if (ev.type === 'add') {
        const r = await sendCapiEvent(tenant, {
          eventName: 'Conversacion',
          eventId: `conv-${ev.leadId}`,
          userData: ud,
          customData: {
            campaign_id: readLeadField(lead, tenant.fieldUtmCampaign) ?? undefined,
            internal_event: 'ConversacionCRM',
          },
          leadId: row?.id ?? null,
        });
        results.push(r);
      } else if (ev.type === 'status' && ev.statusId === tenant.statusCargoId) {
        const r = await sendCapiEvent(tenant, {
          eventName: 'Cargo',
          eventId: `cargo-${ev.leadId}`,
          userData: ud,
          customData: { internal_event: 'CargoCRM' },
          leadId: row?.id ?? null,
        });
        // marcar convertido
        if (row) {
          await db.update(leads).set({ converted: true }).where(eq(leads.id, row.id));
        }
        results.push(r);
      }
      // otros cambios de etapa: solo actualizamos status (ya hecho en upsert)
    } catch (e) {
      console.error(`[kommo-webhook ${tenant.slug}] lead ${ev.leadId}:`, e);
      results.push({ leadId: ev.leadId, error: String(e) });
    }
  }

  return NextResponse.json({ ok: true, processed: results.length, results });
}

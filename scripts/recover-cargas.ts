import { and, eq, sql, gte } from 'drizzle-orm';
import { db } from '@/db';
import { metaEvents, kommoWebhookLog, leads, attributions } from '@/db/schema';
import { getTenantBySlug } from '@/lib/tenants';
import { fetchKommoLead, readLeadField, readPhone, contactId, fetchContactPhone, parseLeadIds } from '@/lib/kommo';
import { sendCapiEvent, CAPI_VALUE } from '@/lib/meta';

const AR = 'America/Argentina/Buenos_Aires';
const DRY = process.env.DRY !== '0';

async function main() {
  const t = await getTenantBySlug('bblack');
  if (!t) throw new Error('no tenant');
  const days = (process.argv[2] ?? '2026-08-07,2026-08-08').split(',');
  console.log('DRY_RUN:', DRY, '| días:', days.join(', '));

  const wbDay = sql<string>`to_char(${kommoWebhookLog.receivedAt} AT TIME ZONE ${sql.raw(`'${AR}'`)}, 'YYYY-MM-DD')`;
  const rows = await db
    .select({ day: wbDay, body: kommoWebhookLog.body, at: kommoWebhookLog.receivedAt })
    .from(kommoWebhookLog)
    .where(and(eq(kommoWebhookLog.tenantId, t.id), gte(kommoWebhookLog.receivedAt, sql`now() - interval '9 days'`)));

  // leadId -> receivedAt más temprano (día AR objetivo)
  const firstSeen = new Map<number, Date>();
  for (const r of rows as any[]) {
    if (!days.includes(r.day)) continue;
    if ((r.body?.source ?? '') !== 'conversion-event') continue;
    for (const id of parseLeadIds(String(r.body?.raw ?? ''), new URLSearchParams())) {
      const prev = firstSeen.get(id);
      if (!prev || r.at < prev) firstSeen.set(id, r.at);
    }
  }
  console.log('leads candidatos:', firstSeen.size);

  let sent = 0, skipped = 0, failed = 0, noPhone = 0;
  for (const [leadId, at] of firstSeen) {
    const cargoId = `cargo-${leadId}`;
    const [exists] = await db.select({ id: metaEvents.id }).from(metaEvents)
      .where(and(eq(metaEvents.tenantId, t.id), eq(metaEvents.eventId, cargoId), eq(metaEvents.status, 'sent'))).limit(1);
    if (exists) { skipped++; continue; }

    let lead;
    try { lead = await fetchKommoLead(t, leadId); } catch { failed++; continue; }
    let phone = readPhone(lead);
    if (!phone) { const c = contactId(lead); if (c) phone = await fetchContactPhone(t, c); }
    if (!phone) { noPhone++; continue; }

    const ud: any = {
      fbc: readLeadField(lead, t.fieldFbc), fbp: readLeadField(lead, t.fieldFbp),
      fbclid: readLeadField(lead, t.fieldFbclid), phone,
    };
    let campaign = readLeadField(lead, t.fieldUtmCampaign);
    if (!campaign || !ud.fbc) {
      const [a] = await db.select({ campaignId: attributions.campaignId, fbc: attributions.fbc, fbp: attributions.fbp, fbclid: attributions.fbclid })
        .from(attributions).where(and(eq(attributions.tenantId, t.id), eq(attributions.matchedLeadId, leadId))).limit(1);
      if (a) { campaign = campaign ?? a.campaignId ?? null; ud.fbc = ud.fbc ?? a.fbc; ud.fbp = ud.fbp ?? a.fbp; ud.fbclid = ud.fbclid ?? a.fbclid; }
    }

    if (DRY) { console.log(`  [DRY] ${leadId} @${at.toISOString()} camp=${campaign ?? '-'} fbc=${ud.fbc ? 'sí' : 'no'}`); sent++; continue; }

    const [row] = await db.insert(leads).values({
      tenantId: t.id, kommoLeadId: leadId, kommoContactId: contactId(lead), name: lead.name ?? null,
      phone, campaignId: campaign, converted: true, updatedAt: new Date(),
    }).onConflictDoUpdate({ target: [leads.tenantId, leads.kommoLeadId], set: { converted: true, phone, updatedAt: new Date() } }).returning();

    const r = await sendCapiEvent(t, {
      eventName: 'Cargo', eventId: cargoId, userData: ud, eventTime: at, leadId: row?.id ?? null,
      customData: { campaign_id: campaign ?? undefined, internal_event: 'CargoCRM', ...CAPI_VALUE },
    });
    if (r.ok) sent++; else { failed++; console.log(`  FAIL ${leadId}:`, JSON.stringify(r.body).slice(0, 150)); }
  }
  console.log(`\nRESULTADO: enviados=${sent} skip(ya existían)=${skipped} sinTel=${noPhone} fallos=${failed}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

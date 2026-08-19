import { desc, eq, and } from 'drizzle-orm';
import { db } from '@/db';
import { kommoWebhookLog } from '@/db/schema';
import { getTenantBySlug, } from '@/lib/tenants';
import { fetchKommoLead, readLeadField, parseLeadIds } from '@/lib/kommo';

async function main() {
  const slug = process.argv[2] ?? 'king';
  const t = await getTenantBySlug(slug);
  if (!t) throw new Error('no tenant');
  const rows = await db
    .select()
    .from(kommoWebhookLog)
    .where(eq(kommoWebhookLog.tenantId, t.id))
    .orderBy(desc(kommoWebhookLog.receivedAt))
    .limit(80);
  const portal = rows.filter((r: any) => (r.body?.source ?? '') === 'portal');
  console.log('entradas portal (últimas):', portal.length);
  for (const r of portal.slice(0, 8)) {
    const raw = (r as any).body?.raw ?? '';
    const ids = parseLeadIds(String(raw), new URLSearchParams());
    console.log(`  log ${(r as any).receivedAt ?? ''} leadIds=${JSON.stringify(ids)}`);
    for (const id of ids) {
      try {
        const lead = await fetchKommoLead(t, id);
        console.log(`     lead ${id} PORTAL_URL=${readLeadField(lead, t.customFields['portal_url_field']) ?? '(vacío)'} USER=${readLeadField(lead, t.customFields['portal_user_field']) ?? '-'} PASS=${readLeadField(lead, t.customFields['portal_pass_field']) ?? '-'}`);
      } catch (e) {
        console.log(`     lead ${id} error ${e}`);
      }
    }
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

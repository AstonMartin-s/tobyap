import { eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { metaEvents } from '@/db/schema';
import { getTenantBySlug } from '@/lib/tenants';
async function main(){
  const t = await getTenantBySlug('king'); if(!t) throw new Error('no tenant');
  const rows = await db.select({ camp: metaEvents.campaignId, type: metaEvents.eventType, n: sql<number>`count(*)::int` })
    .from(metaEvents).where(eq(metaEvents.tenantId, t.id)).groupBy(metaEvents.campaignId, metaEvents.eventType);
  for (const r of rows) console.log(r.camp ?? '(sin campaña)', '|', r.type, '|', r.n);
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1);});

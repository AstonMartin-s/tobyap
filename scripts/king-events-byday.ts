import { eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { metaEvents } from '@/db/schema';
import { getTenantBySlug } from '@/lib/tenants';
const AR = 'America/Argentina/Buenos_Aires';
async function main(){
  const t = await getTenantBySlug('king'); if(!t) throw new Error('no tenant');
  const dayExpr = sql<string>`to_char(${metaEvents.sentAt} AT TIME ZONE ${sql.raw(`'${AR}'`)}, 'YYYY-MM-DD')`;
  const rows = await db.select({ day: dayExpr, type: metaEvents.eventType, n: sql<number>`count(*)::int` })
    .from(metaEvents).where(eq(metaEvents.tenantId, t.id)).groupBy(dayExpr, metaEvents.eventType).orderBy(dayExpr);
  for (const r of rows) console.log(r.day, '|', r.type, '|', r.n);
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1);});

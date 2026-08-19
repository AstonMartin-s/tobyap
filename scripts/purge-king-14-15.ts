import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { metaEvents } from '@/db/schema';
import { getTenantBySlug } from '@/lib/tenants';
const AR = 'America/Argentina/Buenos_Aires';
async function main(){
  const t = await getTenantBySlug('king'); if(!t) throw new Error('no tenant');
  const dayExpr = sql<string>`to_char(${metaEvents.sentAt} AT TIME ZONE ${sql.raw(`'${AR}'`)}, 'YYYY-MM-DD')`;
  // preview antes de borrar
  const preview = await db.select({ day: dayExpr, type: metaEvents.eventType, n: sql<number>`count(*)::int` })
    .from(metaEvents).where(and(eq(metaEvents.tenantId, t.id), sql`${dayExpr} in ('2026-08-14','2026-08-15')`))
    .groupBy(dayExpr, metaEvents.eventType);
  console.log('PREVIEW a borrar:', JSON.stringify(preview));

  const deleted = await db.delete(metaEvents).where(and(eq(metaEvents.tenantId, t.id), sql`${dayExpr} in ('2026-08-14','2026-08-15')`)).returning({ id: metaEvents.id });
  console.log('borrados:', deleted.length);
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1);});

import { and, eq, gte, sql, isNull } from 'drizzle-orm';
import { db } from '@/db';
import { chatSessions } from '@/db/schema';
import { getTenantBySlug } from '@/lib/tenants';
async function main(){
  const t = await getTenantBySlug('king'); if(!t) throw new Error('no tenant');
  // ventanas de 15 min de las últimas 3hs
  const rows = await db.select({
    bucket: sql<string>`to_char(date_trunc('hour', ${chatSessions.createdAt}) + interval '15 min' * floor(extract(minute from ${chatSessions.createdAt})/15), 'HH24:MI')`,
    total: sql<number>`count(*)::int`,
    sinLead: sql<number>`count(*) filter (where ${chatSessions.kommoLeadId} is null)::int`,
  }).from(chatSessions)
    .where(and(eq(chatSessions.tenantId, t.id), gte(chatSessions.createdAt, new Date(Date.now()-4*3600_000))))
    .groupBy(sql`1`).orderBy(sql`1`);
  console.log('ventana(UTC) | total | sin_lead');
  for (const r of rows) console.log(' ', r.bucket, '|', r.total, '|', r.sinLead);
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1);});

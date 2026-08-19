import { and, eq, gte, sql } from 'drizzle-orm';
import { db } from '@/db';
import { metaEvents, chatSessions } from '@/db/schema';
import { getTenantBySlug } from '@/lib/tenants';
async function main(){
  const t = await getTenantBySlug('king'); if(!t) throw new Error('no tenant');
  const evs = await db.select().from(metaEvents).where(eq(metaEvents.tenantId, t.id));
  console.log('total metaEvents king:', evs.length);
  const byType: Record<string,number> = {};
  for (const e of evs) byType[e.eventType ?? '?'] = (byType[e.eventType ?? '?']??0)+1;
  console.log('por tipo:', JSON.stringify(byType));
  console.log('rango fechas:', evs.map(e=>e.createdAt).sort()[0], '..', evs.map(e=>e.createdAt).sort().slice(-1)[0]);

  const sessions = await db.select().from(chatSessions).where(eq(chatSessions.tenantId, t.id));
  console.log('\nchat_sessions king:', sessions.length);
  for (const s of sessions) console.log(' ', s.name, '|', s.phone, '|', s.step, '|', s.createdAt);
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1);});

import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { metaEvents } from '@/db/schema';
import { getTenantBySlug } from '@/lib/tenants';
async function main(){
  const t = await getTenantBySlug('king'); if(!t) throw new Error('no tenant');
  const lead = Number(process.argv[2]);
  const [ev] = await db.select().from(metaEvents).where(and(eq(metaEvents.tenantId,t.id), eq(metaEvents.eventId, `conv-${lead}`)));
  if (!ev) { console.log('NO EVENT'); process.exit(0); }
  console.log('eventName:', ev.eventName, '| status:', ev.status);
  const payload = ev.payload as any;
  console.log('user_data enviado a Meta:', JSON.stringify(payload?.user_data));
  console.log('custom_data:', JSON.stringify(payload?.custom_data));
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1);});

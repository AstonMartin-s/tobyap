import { desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { chatSessions } from '@/db/schema';
import { getTenantBySlug } from '@/lib/tenants';
async function main(){
  const t = await getTenantBySlug('king'); if(!t) throw new Error('no tenant');
  const rows = await db.select().from(chatSessions).where(eq(chatSessions.tenantId, t.id)).orderBy(desc(chatSessions.createdAt)).limit(4);
  for(const r of rows){
    console.log('sessionKey:', r.sessionKey, '| lead:', r.kommoLeadId, '| step:', r.step, '| msgs:', (r.messages??[]).length);
  }
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1);});

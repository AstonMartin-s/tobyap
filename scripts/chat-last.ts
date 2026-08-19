import { desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { chatSessions } from '@/db/schema';
import { getTenantBySlug } from '@/lib/tenants';
async function main(){
  const t = await getTenantBySlug('king'); if(!t) throw new Error('no tenant');
  const rows = await db.select().from(chatSessions).where(eq(chatSessions.tenantId, t.id)).orderBy(desc(chatSessions.createdAt)).limit(3);
  for(const r of rows){
    console.log('---', r.createdAt, 'phone', r.phone, 'name', JSON.stringify(r.name));
    console.log('  data:', JSON.stringify(r.data));
  }
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1);});

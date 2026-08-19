import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { clientSettings } from '@/db/schema';
import { getTenantBySlug } from '@/lib/tenants';
async function main(){
  const t = await getTenantBySlug('king'); if(!t) throw new Error('no tenant');
  const [s] = await db.select().from(clientSettings).where(eq(clientSettings.tenantId, t.id));
  console.log('walink:', s?.walink);
  console.log('regularMessage:', s?.regularMessage);
  console.log('message:', s?.message);
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1);});

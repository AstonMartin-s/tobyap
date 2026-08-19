import { getTenantBySlug } from '@/lib/tenants';
import { db } from '@/db';
import { numbers } from '@/db/schema';
import { eq } from 'drizzle-orm';
async function main(){
  const t = await getTenantBySlug('mooneyatkinson'); if(!t) throw new Error('no tenant');
  const ns = await db.select().from(numbers).where(eq(numbers.tenantId, t.id));
  for (const n of ns) console.log(n.name, n.phone, n.status);
  console.log('total:', ns.length);
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1);});

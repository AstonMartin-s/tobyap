import { getTenantBySlug } from '@/lib/tenants';
import { db } from '@/db';
import { landings, numbers } from '@/db/schema';
import { eq } from 'drizzle-orm';
async function main(){
  const t = await getTenantBySlug('mooneyatkinson'); if(!t) throw new Error('no tenant');
  console.log('tenant id:', t.id, 'pixel:', t.metaPixelId, 'suffix:', t.eventSuffix);
  const ls = await db.select().from(landings).where(eq(landings.tenantId, t.id));
  console.log('landings existentes:', ls.map(l=>({slug:l.landingSlug, type:l.type, active:l.active})));
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1);});

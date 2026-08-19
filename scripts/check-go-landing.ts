import { eq, and } from 'drizzle-orm';
import { db } from '@/db';
import { landings } from '@/db/schema';
import { getTenantBySlug } from '@/lib/tenants';
async function main(){
  const t = await getTenantBySlug('king'); if(!t) throw new Error('no tenant');
  const rows = await db.select().from(landings).where(and(eq(landings.tenantId, t.id), eq(landings.landingSlug, 'go')));
  console.log('filas encontradas:', rows.length);
  for (const r of rows) console.log(JSON.stringify({ id: r.id, active: r.active, config: r.config }));
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1);});

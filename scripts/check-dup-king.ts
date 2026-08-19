import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { tenants, landings } from '@/db/schema';
async function main(){
  const ts = await db.select().from(tenants).where(eq(tenants.slug, 'king'));
  console.log('tenants con slug king:', ts.length);
  for (const t of ts) {
    console.log(' tenant', t.id, 'active:', t.active);
    const ls = await db.select().from(landings).where(eq(landings.tenantId, t.id));
    for (const l of ls) console.log('   landing', l.landingSlug, 'active:', l.active, 'hasChatSlug:', JSON.stringify(l.config).includes('chatSlug'));
  }
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1);});

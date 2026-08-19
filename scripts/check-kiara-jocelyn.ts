import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { chatSessions } from '@/db/schema';
import { getTenantBySlug } from '@/lib/tenants';
async function main(){
  const t = await getTenantBySlug('king'); if(!t) throw new Error('no tenant');
  const rows = await db.select().from(chatSessions).where(and(eq(chatSessions.tenantId, t.id), inArray(chatSessions.name, ['Kiara ', 'Jocelyn yose'])));
  for (const r of rows) console.log(r.name, '|', r.phone, '| lead:', r.kommoLeadId, '| createdAt:', r.createdAt);
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1);});

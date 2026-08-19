import { desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { chatSessions } from '@/db/schema';
import { getTenantBySlug } from '@/lib/tenants';
import { fetchKommoLead } from '@/lib/kommo';
async function main(){
  const t = await getTenantBySlug('king'); if(!t) throw new Error('no tenant');
  console.log('statusCargoId (tenant):', t.statusCargoId, '| customFields.status_cargo:', t.customFields['status_cargo']);
  const rows = await db.select().from(chatSessions).where(eq(chatSessions.tenantId, t.id)).orderBy(desc(chatSessions.createdAt)).limit(2);
  for(const r of rows){
    console.log('--- session', r.sessionKey.slice(0,8), 'step:', r.step, 'lead:', r.kommoLeadId, 'msgs:', (r.messages??[]).length);
    if (r.kommoLeadId) {
      try {
        const lead = await fetchKommoLead(t, r.kommoLeadId);
        console.log('    lead status_id:', lead.status_id, 'pipeline:', lead.pipeline_id, 'name:', lead.name);
      } catch(e){ console.log('    lead fetch err', e); }
    }
  }
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1);});

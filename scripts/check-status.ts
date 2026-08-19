import { db } from '@/db';
import { getTenantBySlug } from '@/lib/tenants';
import { fetchKommoLead, fetchPipelineStatuses } from '@/lib/kommo';
async function main(){
  const t = await getTenantBySlug('king'); if(!t) throw new Error('no tenant');
  const lead = await fetchKommoLead(t, 65712662);
  console.log('lead 65712662 status_id:', lead.status_id, '(type', typeof lead.status_id, ') pipeline:', lead.pipeline_id);
  console.log('tenant.statusCargoId:', t.statusCargoId, '(type', typeof t.statusCargoId, ')');
  console.log('match?', lead.status_id === t.statusCargoId);
  console.log('=== etapas del pipeline 12474051 ===');
  const sts = await fetchPipelineStatuses(t, 12474051);
  for(const s of sts) console.log('   ', s.id, s.name);
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1);});

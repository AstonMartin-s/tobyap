import { getTenantBySlug } from '@/lib/tenants';
import { fetchPipelines } from '@/lib/kommo';
async function main(){
  const t = await getTenantBySlug('king'); if(!t) throw new Error('no tenant');
  const pipes = await fetchPipelines(t);
  for (const p of pipes) {
    console.log(`\n[${p.id}] ${p.name}`);
    for (const s of p._embedded?.statuses ?? []) console.log(`   ${s.id}  ${s.name}`);
  }
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1);});

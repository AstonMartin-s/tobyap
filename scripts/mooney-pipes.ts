import { getTenantBySlug } from '@/lib/tenants';
import { fetchPipelines } from '@/lib/kommo';

async function main() {
  const t = await getTenantBySlug('mooneyatkinson');
  if (!t) throw new Error('no tenant');
  const pipes = await fetchPipelines(t);
  console.log('pipeline principal del tenant:', t.kommoPipelineId);
  for (const p of pipes) {
    console.log(`\n[${p.id}] ${p.name}`);
    for (const s of p._embedded?.statuses ?? []) console.log(`   - ${s.id}  ${s.name}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

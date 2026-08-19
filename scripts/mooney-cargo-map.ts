import { getTenantBySlug } from '@/lib/tenants';
import { fetchPipelines } from '@/lib/kommo';

async function main() {
  const t = await getTenantBySlug('mooneyatkinson');
  if (!t) throw new Error('no tenant');
  console.log('status_cargo (tenant):', t.customFields['status_cargo']);
  console.log('status_revisar_imagen:', t.customFields['status_revisar_imagen']);
  console.log('pipeline principal:', t.kommoPipelineId);
  const pipes = await fetchPipelines(t);
  for (const p of pipes) {
    if (![13031403, 13498699, 12175799].includes(p.id)) continue;
    console.log(`\n[${p.id}] ${p.name}`);
    for (const s of p._embedded?.statuses ?? []) console.log(`   ${s.id}  ${s.name}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

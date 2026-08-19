import { getTenantBySlug, updateTenantFields } from '@/lib/tenants';

async function main() {
  const t = await getTenantBySlug('king');
  if (!t) throw new Error('no tenant');
  const cf: Record<string, number> = { ...(t.customFields as Record<string, number>) };
  cf['clientes_pipeline'] = 14254791; // Clientes Regulares
  cf['status_atencion_manual'] = 110075279; // Atencion Manual/Derivado
  await updateTenantFields('king', { customFields: cf });
  console.log('OK king customFields:', JSON.stringify({ clientes_pipeline: cf['clientes_pipeline'], status_atencion_manual: cf['status_atencion_manual'] }));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

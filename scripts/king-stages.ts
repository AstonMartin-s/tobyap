import { getTenantBySlug } from '@/lib/tenants';
async function main(){
  const t = await getTenantBySlug('king'); if(!t) throw new Error('no tenant');
  console.log('statusRevisarImagenId:', t.statusRevisarImagenId, '| customFields.status_revisar_imagen:', t.customFields['status_revisar_imagen']);
  console.log('statusCargoId:', t.statusCargoId, '| pipeline:', t.kommoPipelineId);
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1);});

import { getTenantBySlug } from '@/lib/tenants';
async function main(){
  const t = await getTenantBySlug('king'); if(!t) throw new Error('no tenant');
  const url = `https://${t.kommoSubdomain}.kommo.com/api/v4`;
  const H = { Authorization: `Bearer ${t.kommoToken}`, 'Content-Type': 'application/json' };
  const leadName = 'DiagnosticoTest';
  const body = [{
    name: leadName,
    ...(t.kommoPipelineId ? { pipeline_id: t.kommoPipelineId } : {}),
    _embedded: {
      contacts: [{
        first_name: leadName,
        custom_fields_values: [{ field_code: 'PHONE', values: [{ value: '5491100000000', enum_code: 'WORK' }] }],
      }],
    },
  }];
  const r = await fetch(`${url}/leads/complex`, { method: 'POST', headers: H, body: JSON.stringify(body) });
  console.log('HTTP status:', r.status);
  const text = await r.text();
  console.log('BODY:', text);
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1);});

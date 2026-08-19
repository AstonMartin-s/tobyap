import { getTenantBySlug } from '@/lib/tenants';
async function main(){
  const t = await getTenantBySlug('king'); if(!t) throw new Error('no tenant');
  const r = await fetch(`https://${t.kommoSubdomain}.kommo.com/api/v4/account`, { headers:{ Authorization:`Bearer ${t.kommoToken}` }});
  const j:any = await r.json();
  console.log('account id:', j.id, '| subdomain:', j.subdomain, '| name:', j.name);
  console.log('amojo_id (si aparece):', j.amojo_id ?? '(no en esta respuesta)');
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1);});

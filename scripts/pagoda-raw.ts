import { getTenantBySlug } from '@/lib/tenants';
import { createPortalAccount } from '@/lib/pagoda';
async function main(){
  const t = await getTenantBySlug('king'); if(!t) throw new Error('no tenant');
  // teléfono que YA tiene cuenta (jenny5314)
  const acc = await createPortalAccount(t, { phone: '5491176242882', name: 'PruebaExistente' });
  console.log('parsed: existing=', acc.existing, 'user=', acc.username);
  console.log('RAW:', JSON.stringify(acc.raw));
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1);});

import { getTenantBySlug } from '@/lib/tenants';
import { db } from '@/db';
import { clientSettings, landings } from '@/db/schema';
import { eq } from 'drizzle-orm';
async function main(){
  const t = await getTenantBySlug('king'); if(!t) throw new Error('no tenant');
  const [s] = await db.select().from(clientSettings).where(eq(clientSettings.tenantId, t.id));
  const ls = await db.select().from(landings).where(eq(landings.tenantId, t.id));
  console.log('pagodaUrl:', t.pagodaUrl, '| pagodaKey set:', !!t.pagodaApiKey);
  console.log('portal fields:', t.customFields['portal_url_field'], t.customFields['portal_user_field'], t.customFields['portal_pass_field']);
  console.log('cbu_field/titular_field:', t.customFields['cbu_field'], t.customFields['titular_field']);
  console.log('status_cargo:', t.customFields['status_cargo'], '| pipeline:', t.kommoPipelineId);
  console.log('settings:', JSON.stringify({accountName:s?.accountName, accountCbu:s?.accountCbu, message:s?.message, regularMessage:s?.regularMessage, walink:s?.walink}));
  for(const l of ls) console.log('landing', l.landingSlug, 'config:', JSON.stringify(l.config));
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1);});

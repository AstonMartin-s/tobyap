import { getTenantBySlug } from '@/lib/tenants';
import { fetchKommoLead, readLeadField } from '@/lib/kommo';
async function main() {
  const t = await getTenantBySlug('king'); if (!t) throw new Error('no tenant');
  const id = Number(process.argv[2]);
  const lead = await fetchKommoLead(t, id);
  console.log('name WA:', lead.name);
  console.log('PORTAL_URL :', readLeadField(lead, t.customFields['portal_url_field']));
  console.log('PORTAL_USER:', readLeadField(lead, t.customFields['portal_user_field']));
  console.log('PORTAL_PASS:', readLeadField(lead, t.customFields['portal_pass_field']));
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1);});

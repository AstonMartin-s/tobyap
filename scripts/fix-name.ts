import { getTenantBySlug } from '@/lib/tenants';
import { fetchKommoLead, readLeadField, updateLeadName } from '@/lib/kommo';

async function main() {
  const slug = process.argv[2] ?? 'king';
  const id = Number(process.argv[3]);
  const t = await getTenantBySlug(slug);
  if (!t) throw new Error('no tenant');
  const lead = await fetchKommoLead(t, id);
  const user = readLeadField(lead, t.customFields['portal_user_field']);
  console.log('lead', id, 'nombre actual:', JSON.stringify(lead.name), 'PORTAL_USER:', user);
  if (!user) { console.log('sin PORTAL_USER, nada que setear'); process.exit(0); }
  const ok = await updateLeadName(t, id, user);
  console.log('updateLeadName ok?', ok);
  const after = await fetchKommoLead(t, id);
  console.log('nombre después:', JSON.stringify(after.name));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

import { getTenantBySlug } from '@/lib/tenants';
async function main() {
  const slug = process.argv[2] ?? 'king';
  const t = await getTenantBySlug(slug);
  if (!t) throw new Error('no tenant');
  const base = `https://${t.kommoSubdomain}.kommo.com/api/v4/leads/custom_fields?limit=250`;
  const r = await fetch(base, { headers: { Authorization: `Bearer ${t.kommoToken}` } });
  const j: any = await r.json();
  const all = j?._embedded?.custom_fields ?? [];
  console.log('total custom fields:', all.length);
  for (const f of all) {
    if (/portal|cbu|titular|ad_code/i.test(String(f.name))) {
      console.log(`  id=${f.id}  name="${f.name}"  type=${f.type}  code=${f.code ?? '-'}`);
    }
  }
  console.log('mapeo DB:', JSON.stringify({
    url: t.customFields['portal_url_field'],
    user: t.customFields['portal_user_field'],
    pass: t.customFields['portal_pass_field'],
  }));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

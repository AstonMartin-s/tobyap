import { getTenantBySlug } from '@/lib/tenants';
import { readPhone } from '@/lib/kommo';

async function main() {
  const slug = process.argv[2] ?? 'king';
  const t = await getTenantBySlug(slug);
  if (!t) throw new Error('no tenant');
  const url = `https://${t.kommoSubdomain}.kommo.com/api/v4/leads?limit=20&order[updated_at]=desc&with=contacts`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${t.kommoToken}` } });
  const j: any = await r.json();
  const leads = j?._embedded?.leads ?? [];
  console.log('leads recientes:', leads.length);
  for (const l of leads) {
    const phone = readPhone(l);
    console.log(`  id=${l.id}  name="${l.name}"  phone=${phone ?? '-'}  status=${l.status_id}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

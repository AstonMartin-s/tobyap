import { getTenantBySlug } from '@/lib/tenants';

// Cuenta leads por (pipeline,status) creados en la ventana, paginando.
async function countLeads(sub: string, token: string, pipeline: number, status: number, from: number, to: number, dateField = 'updated_at') {
  let page = 1, total = 0;
  const dateFilter = from ? `&filter[${dateField}][from]=${from}&filter[${dateField}][to]=${to}` : '';
  for (;;) {
    const url = `https://${sub}.kommo.com/api/v4/leads?filter[statuses][0][pipeline_id]=${pipeline}&filter[statuses][0][status_id]=${status}${dateFilter}&limit=250&page=${page}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (r.status === 204) break;
    if (!r.ok) { console.error('err', status, r.status); break; }
    const j: any = await r.json();
    const arr = j?._embedded?.leads ?? [];
    total += arr.length;
    if (arr.length < 250) break;
    page++;
    if (page > 40) break;
  }
  return total;
}

async function main() {
  const t = await getTenantBySlug('mooneyatkinson');
  if (!t?.kommoSubdomain || !t?.kommoToken) throw new Error('no tenant/token');
  const sub = t.kommoSubdomain, tok = t.kommoToken;
  const from = Math.floor(new Date('2026-07-10T00:00:00-03:00').getTime() / 1000);
  const to = Math.floor(new Date('2026-08-14T00:00:00-03:00').getTime() / 1000);

  // TUBERIA MAESTRA (13498699) — circuito remarketing ♥️
  const TM = 13498699;
  const stages: Array<[string, number, number]> = [
    ['R1 - ENTRADA Remarketing', TM, 104139519],
    ['R2 - CONVERTIDO (cargó)',  TM, 104139523],
    ['R3 - NO CONVERTIDO',       TM, 104139527],
    // ETAPAS (SA) 13031403 remarketing
    ['SA R1 - ENTRADA Remarketing', 13031403, 101136983],
    ['SA Quedo Remarketing',        13031403, 102836439],
  ];
  console.log('== Baseline: leads ACTUALES en cada etapa (sin filtro fecha) ==');
  for (const [name, pipe, st] of stages) {
    const n = await countLeads(sub, tok, pipe, st, 0, 0);
    console.log(`  ${name}: ${n}`);
  }
  console.log('\n== Movidos en la ventana 10/07–13/08 (updated_at) ==');
  for (const [name, pipe, st] of stages) {
    const n = await countLeads(sub, tok, pipe, st, from, to);
    console.log(`  ${name}: ${n}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

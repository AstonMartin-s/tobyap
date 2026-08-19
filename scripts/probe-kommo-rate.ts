import { getTenantBySlug } from '@/lib/tenants';
async function main(){
  const t = await getTenantBySlug('king'); if(!t) throw new Error('no tenant');
  const url = `https://${t.kommoSubdomain}.kommo.com/api/v4/account`;
  const H = { Authorization: `Bearer ${t.kommoToken}` };
  // Ráfaga de 25 requests en paralelo (simula pico de tráfico de ads)
  const results = await Promise.all(Array.from({length:25}, () =>
    fetch(url, { headers: H }).then(r => r.status).catch(() => 'ERR')
  ));
  const counts: Record<string,number> = {};
  for (const s of results) counts[String(s)] = (counts[String(s)]??0)+1;
  console.log('ráfaga de 25 requests → status:', JSON.stringify(counts));
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1);});

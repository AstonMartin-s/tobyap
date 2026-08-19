// Diagnóstico read-only: mapeo de customFields + eventos recientes de un tenant.
//   npm run check-tenant -- <slug>
import { and, eq, gte, sql } from 'drizzle-orm';
import { db } from '@/db';
import { tenants, metaEvents } from '@/db/schema';

async function main() {
  const slug = process.argv[2] || 'clienteA1';
  const [t] = await db.select().from(tenants).where(eq(tenants.slug, slug)).limit(1);
  if (!t) { console.error(`tenant ${slug} no existe`); process.exit(1); }

  const cf = (t.customFields ?? {}) as Record<string, number>;
  console.log(`\n=== ${slug} (${t.name}) ===`);
  console.log('pixel:', t.metaPixelId, '| pipeline:', t.kommoPipelineId, '| readonly:', t.readonly);
  console.log('customFields keys:', Object.keys(cf));
  console.log('ad_code mapeado?:', cf['ad_code'] ? `SÍ (id ${cf['ad_code']})` : '❌ NO');
  console.log('utm_campaign:', cf['utm_campaign'] ?? '—', '| fbc:', cf['fbc'] ?? '—', '| fbp:', cf['fbp'] ?? '—', '| fbclid:', cf['fbclid'] ?? '—');

  const since = new Date(Date.now() - 36 * 3600 * 1000);
  const rows = await db
    .select({
      type: metaEvents.eventType,
      status: metaEvents.status,
      campaign: metaEvents.campaignId,
      n: sql<number>`count(*)::int`,
    })
    .from(metaEvents)
    .where(and(eq(metaEvents.tenantId, t.id), gte(metaEvents.createdAt, since)))
    .groupBy(metaEvents.eventType, metaEvents.status, metaEvents.campaignId)
    .orderBy(metaEvents.eventType);
  console.log('\n=== metaEvents últimas 36h (type/status/campaign/count) ===');
  if (!rows.length) console.log('(sin eventos)');
  for (const r of rows) console.log(`${(r.type ?? '?').padEnd(13)} ${(r.status ?? '?').padEnd(8)} ${(r.campaign ?? '(null)').padEnd(10)} ${r.n}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

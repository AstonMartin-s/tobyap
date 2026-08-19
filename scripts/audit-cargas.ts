import { and, eq, sql, gte } from 'drizzle-orm';
import { db } from '@/db';
import { metaEvents, kommoWebhookLog } from '@/db/schema';
import { getTenantBySlug } from '@/lib/tenants';
import { parseLeadIds } from '@/lib/kommo';

const AR = 'America/Argentina/Buenos_Aires';

async function main() {
  const slug = process.argv[2] ?? 'bblack';
  const t = await getTenantBySlug(slug);
  if (!t) throw new Error('no tenant');
  console.log('tenant', slug, t.id, 'pipeline', t.kommoPipelineId, 'status_cargo', t.customFields['status_cargo']);

  // 1) Cargas MEDIDAS (metaEvents cargo) por día AR
  const evDay = sql<string>`to_char(${metaEvents.sentAt} AT TIME ZONE ${sql.raw(`'${AR}'`)}, 'YYYY-MM-DD')`;
  const cargas = await db
    .select({ day: evDay, n: sql<number>`count(*)::int` })
    .from(metaEvents)
    .where(and(eq(metaEvents.tenantId, t.id), eq(metaEvents.eventType, 'cargo')))
    .groupBy(evDay)
    .orderBy(evDay);
  console.log('\n== CARGAS MEDIDAS (metaEvents cargo) por día ==');
  for (const r of cargas) console.log(`  ${r.day}: ${r.n}`);

  // 2) Webhooks de conversión RECIBIDOS por día AR (source=conversion-event)
  const wbDay = sql<string>`to_char(${kommoWebhookLog.receivedAt} AT TIME ZONE ${sql.raw(`'${AR}'`)}, 'YYYY-MM-DD')`;
  const logs = await db
    .select({ day: wbDay, body: kommoWebhookLog.body })
    .from(kommoWebhookLog)
    .where(and(eq(kommoWebhookLog.tenantId, t.id), gte(kommoWebhookLog.receivedAt, sql`now() - interval '8 days'`)));
  const byDay: Record<string, { conv: number; convLeads: Set<number>; other: number }> = {};
  for (const l of logs as any[]) {
    const src = l.body?.source ?? '';
    const d = l.day;
    byDay[d] ??= { conv: 0, convLeads: new Set(), other: 0 };
    if (src === 'conversion-event') {
      byDay[d].conv++;
      for (const id of parseLeadIds(String(l.body?.raw ?? ''), new URLSearchParams())) byDay[d].convLeads.add(id);
    } else byDay[d].other++;
  }
  console.log('\n== WEBHOOKS conversion-event RECIBIDOS por día ==');
  for (const d of Object.keys(byDay).sort()) console.log(`  ${d}: hits=${byDay[d].conv} leadsUnicos=${byDay[d].convLeads.size} (otros webhooks=${byDay[d].other})`);

  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

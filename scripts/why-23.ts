import { and, eq, sql, isNotNull } from 'drizzle-orm';
import { db } from '@/db';
import { metaEvents } from '@/db/schema';
import { getTenantBySlug } from '@/lib/tenants';
import { getDailyReport } from '@/lib/reports';

const AR = 'America/Argentina/Buenos_Aires';
async function main() {
  const t = await getTenantBySlug('bblack');
  if (!t) throw new Error('no tenant');
  const evDay = sql<string>`to_char(${metaEvents.sentAt} AT TIME ZONE ${sql.raw(`'${AR}'`)}, 'YYYY-MM-DD')`;

  // 1) raw por status para 08-07
  const byStatus = await db
    .select({ status: metaEvents.status, n: sql<number>`count(*)::int` })
    .from(metaEvents)
    .where(and(eq(metaEvents.tenantId, t.id), eq(metaEvents.eventType, 'cargo'), sql`${evDay} = '2026-08-07'`))
    .groupBy(metaEvents.status);
  console.log('08-07 cargo por status:', JSON.stringify(byStatus));

  // 2) raw por campaignId para 08-07
  const byCamp = await db
    .select({ camp: metaEvents.campaignId, n: sql<number>`count(*)::int` })
    .from(metaEvents)
    .where(and(eq(metaEvents.tenantId, t.id), eq(metaEvents.eventType, 'cargo'), sql`${evDay} = '2026-08-07'`))
    .groupBy(metaEvents.campaignId);
  console.log('08-07 cargo por campaignId:', JSON.stringify(byCamp));

  // 3) lo que devuelve getDailyReport
  const daily = await getDailyReport({ start: '2026-07-25', end: '2026-08-07', tenantId: t.id });
  const row = daily.find((r: any) => r.day === '2026-08-07');
  console.log('getDailyReport 08-07:', JSON.stringify(row));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

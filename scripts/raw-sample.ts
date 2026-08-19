import { and, eq, sql, gte } from 'drizzle-orm';
import { db } from '@/db';
import { kommoWebhookLog } from '@/db/schema';
import { getTenantBySlug } from '@/lib/tenants';

const AR = 'America/Argentina/Buenos_Aires';
async function main() {
  const t = await getTenantBySlug('bblack');
  if (!t) throw new Error('no tenant');
  const wbDay = sql<string>`to_char(${kommoWebhookLog.receivedAt} AT TIME ZONE ${sql.raw(`'${AR}'`)}, 'YYYY-MM-DD')`;
  const logs = await db
    .select({ day: wbDay, body: kommoWebhookLog.body, at: kommoWebhookLog.receivedAt })
    .from(kommoWebhookLog)
    .where(and(eq(kommoWebhookLog.tenantId, t.id), gte(kommoWebhookLog.receivedAt, sql`now() - interval '8 days'`)));
  for (const day of ['2026-08-06', '2026-08-07']) {
    const sample = (logs as any[]).find((l) => l.day === day && (l.body?.source ?? '') === 'conversion-event');
    console.log(`\n=== ${day} conversion-event RAW ===`);
    console.log(sample ? String(sample.body?.raw).slice(0, 300) : '(sin muestra)');
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

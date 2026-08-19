import { and, eq, sql, gte } from 'drizzle-orm';
import { db } from '@/db';
import { metaEvents, kommoWebhookLog } from '@/db/schema';
import { getTenantBySlug } from '@/lib/tenants';
import { parseLeadIds } from '@/lib/kommo';

const AR = 'America/Argentina/Buenos_Aires';

async function main() {
  const t = await getTenantBySlug('bblack');
  if (!t) throw new Error('no tenant');

  // metaEvents por status y eventType (todos)
  const byStatus = await db
    .select({ type: metaEvents.eventType, status: metaEvents.status, n: sql<number>`count(*)::int`,
      minSent: sql<string>`min(${metaEvents.sentAt})`, maxSent: sql<string>`max(${metaEvents.sentAt})` })
    .from(metaEvents)
    .where(eq(metaEvents.tenantId, t.id))
    .groupBy(metaEvents.eventType, metaEvents.status);
  console.log('== metaEvents por type/status ==');
  for (const r of byStatus) console.log(`  ${r.type}/${r.status}: ${r.n}  [${r.minSent} .. ${r.maxSent}]`);

  // Sacar los lead ids de los webhooks conversion-event del 08-07
  const wbDay = sql<string>`to_char(${kommoWebhookLog.receivedAt} AT TIME ZONE ${sql.raw(`'${AR}'`)}, 'YYYY-MM-DD')`;
  const logs = await db
    .select({ day: wbDay, body: kommoWebhookLog.body })
    .from(kommoWebhookLog)
    .where(and(eq(kommoWebhookLog.tenantId, t.id), gte(kommoWebhookLog.receivedAt, sql`now() - interval '8 days'`)));
  const leads807 = new Set<number>();
  for (const l of logs as any[]) {
    if (l.day === '2026-08-07' && (l.body?.source ?? '') === 'conversion-event') {
      for (const id of parseLeadIds(String(l.body?.raw ?? ''), new URLSearchParams())) leads807.add(id);
    }
  }
  console.log(`\n== 08-07: ${leads807.size} leads con webhook de carga ==`);

  // Para esos leads, ¿existe el evento cargo-<id> en metaEvents?
  const ids = [...leads807];
  let existen = 0, faltan = 0; const faltantes: number[] = [];
  for (const id of ids) {
    const [row] = await db.select({ id: metaEvents.id, status: metaEvents.status, sentAt: metaEvents.sentAt })
      .from(metaEvents)
      .where(and(eq(metaEvents.tenantId, t.id), eq(metaEvents.eventId, `cargo-${id}`)))
      .limit(1);
    if (row) existen++; else { faltan++; faltantes.push(id); }
  }
  console.log(`  con evento cargo en DB: ${existen}`);
  console.log(`  SIN evento (perdidos): ${faltan}`, faltantes.slice(0, 10));

  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

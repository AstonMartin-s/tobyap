import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { attributions, kommoWebhookLog } from '@/db/schema';
import { getTenantBySlug } from '@/lib/tenants';

async function main() {
  const t = await getTenantBySlug('mooneyatkinson');
  if (!t) throw new Error('no tenant');

  const bl1 = await db
    .select({ code: attributions.code, created: attributions.createdAt, matched: attributions.matchedLeadId })
    .from(attributions)
    .where(and(eq(attributions.tenantId, t.id), eq(attributions.campaignId, 'BL1')));
  console.log(`BL1 attributions: ${bl1.length}`);
  const times = bl1.map((r) => new Date(r.created as any).getTime()).filter((n) => !isNaN(n)).sort((a, b) => a - b);
  console.log('rango fechas:', new Date(times[0]).toISOString(), '..', new Date(times[times.length - 1]).toISOString());
  const tokens = new Set(bl1.map((r) => r.code));

  // Escaneamos TODOS los webhooks de mooney buscando los tokens.
  const logs = await db
    .select({ body: kommoWebhookLog.body, at: kommoWebhookLog.receivedAt })
    .from(kommoWebhookLog)
    .where(eq(kommoWebhookLog.tenantId, t.id));
  console.log(`webhooks mooney totales: ${logs.length}`);

  let found = 0; const hits: string[] = [];
  for (const l of logs as any[]) {
    const raw = typeof l.body?.raw === 'string' ? l.body.raw : JSON.stringify(l.body ?? '');
    for (const tk of tokens) {
      if (raw.includes(tk)) { found++; hits.push(`${tk} @ ${l.at?.toISOString?.() ?? l.at}`); break; }
    }
  }
  console.log(`\nTokens BL1 encontrados en webhooks entrantes: ${found} / ${tokens.size}`);
  for (const h of hits.slice(0, 15)) console.log('  ', h);

  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

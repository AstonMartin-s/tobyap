import { desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { kommoWebhookLog } from '@/db/schema';
import { getTenantBySlug } from '@/lib/tenants';

async function main() {
  const slug = process.argv[2] ?? 'king';
  const t = await getTenantBySlug(slug);
  if (!t) throw new Error('no tenant');
  const rows = await db
    .select()
    .from(kommoWebhookLog)
    .where(eq(kommoWebhookLog.tenantId, t.id))
    .orderBy(desc(kommoWebhookLog.receivedAt))
    .limit(120);
  const portal = rows.filter((r: any) => (r.body?.source ?? '') === 'portal');
  for (const r of portal.slice(0, 3)) {
    console.log('--- receivedAt', (r as any).receivedAt, '---');
    console.log('RAW:', JSON.stringify((r as any).body?.raw));
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

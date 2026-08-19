import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { kommoWebhookLog } from '@/db/schema';
import { getTenantBySlug } from '@/lib/tenants';

async function main() {
  const t = await getTenantBySlug('mooneyatkinson');
  if (!t) throw new Error('no tenant');
  const logs = await db.select({ body: kommoWebhookLog.body }).from(kommoWebhookLog).where(eq(kommoWebhookLog.tenantId, t.id));
  const raws = (logs as any[]).map((l) => (typeof l.body?.raw === 'string' ? l.body.raw : JSON.stringify(l.body ?? '')));
  const go1line = '5491124024628';       // línea remarketing go1 (BL1)
  const rotLineSample = '5491125890332';  // línea reactivacion (control)
  const count = (needle: string) => raws.filter((r) => r.includes(needle)).length;
  console.log('webhooks mooney:', raws.length);
  console.log(`menciones línea go1 (${go1line}):`, count(go1line));
  console.log(`menciones línea reactivacion (${rotLineSample}):`, count(rotLineSample));
  // ¿qué "responsible"/pipelines aparecen? contamos pipeline_id presentes
  const pipes: Record<string, number> = {};
  for (const r of raws) {
    for (const m of r.matchAll(/pipeline_id%5D=(\d+)|pipeline_id"?:?"?(\d+)/g)) {
      const id = m[1] || m[2]; if (id) pipes[id] = (pipes[id] ?? 0) + 1;
    }
  }
  console.log('pipelines vistos en webhooks:', JSON.stringify(pipes));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { attributions, kommoWebhookLog, landings } from '@/db/schema';
import { getTenantBySlug } from '@/lib/tenants';

async function tokensInLogs(logsRaw: string[], tokens: Set<string>) {
  let found = 0;
  for (const raw of logsRaw) for (const tk of tokens) if (raw.includes(tk)) { found++; break; }
  return found;
}

async function main() {
  const t = await getTenantBySlug('mooneyatkinson');
  if (!t) throw new Error('no tenant');

  const logs = await db.select({ body: kommoWebhookLog.body }).from(kommoWebhookLog).where(eq(kommoWebhookLog.tenantId, t.id));
  const raws = (logs as any[]).map((l) => (typeof l.body?.raw === 'string' ? l.body.raw : JSON.stringify(l.body ?? '')));
  console.log('webhooks mooney:', raws.length);

  for (const camp of ['SP3', 'SP1', 'SP5', 'SP5D', 'BL1']) {
    const rows = await db.select({ code: attributions.code, matched: attributions.matchedLeadId })
      .from(attributions).where(and(eq(attributions.tenantId, t.id), eq(attributions.campaignId, camp)));
    const tokens = new Set(rows.map((r) => r.code));
    const matched = rows.filter((r) => r.matched).length;
    const found = await tokensInLogs(raws, tokens);
    console.log(`  ${camp}: attribs=${rows.length} matched=${matched} tokensEnWebhooks=${found}`);
  }

  // Config de landings de mooney (número/tipo)
  const ls = await db.select().from(landings).where(eq(landings.tenantId, t.id));
  console.log('\n== Landings mooney ==');
  for (const l of ls as any[]) {
    const c = l.config ?? {};
    console.log(`  slug=${l.landingSlug} type=${l.type} active=${l.active} waNumber=${c.waNumber ?? '(rotación/none)'} ccpp=${c.ccpp ?? '-'} campaign=${c.campaign ?? '-'} redirectDelayMs=${c.redirectDelayMs ?? '-'}`);
  }

  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

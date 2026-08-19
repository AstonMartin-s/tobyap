import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { db } from '@/db';
import { attributions, metaEvents } from '@/db/schema';
import { getTenantBySlug } from '@/lib/tenants';

async function main() {
  const t = await getTenantBySlug('mooneyatkinson');
  if (!t) throw new Error('no tenant');

  const bl1 = await db.select().from(attributions).where(and(eq(attributions.tenantId, t.id), eq(attributions.campaignId, 'BL1')));
  const fbcs = new Set(bl1.map((r) => r.fbc).filter(Boolean) as string[]);
  const fbps = new Set(bl1.map((r) => r.fbp).filter(Boolean) as string[]);
  console.log(`BL1: ${bl1.length} attribs | fbc unicos=${fbcs.size} fbp unicos=${fbps.size}`);

  // Muestra de una conversacion para ver dónde vive fbc/fbp en el evento
  const [sample] = await db.select().from(metaEvents)
    .where(and(eq(metaEvents.tenantId, t.id), eq(metaEvents.eventType, 'conversacion')))
    .limit(1);
  console.log('\nsample conversacion keys:', sample ? Object.keys(sample) : '(none)');
  console.log('sample payload:', JSON.stringify((sample as any)?.payload)?.slice(0, 400));
  console.log('sample conversionData:', JSON.stringify((sample as any)?.conversionData)?.slice(0, 400));

  // Cruce por fbc: cuántas conversaciones de mooney contienen un fbc de BL1
  const convs = await db.select({ id: metaEvents.id, camp: metaEvents.campaignId, lead: metaEvents.leadId,
      payload: metaEvents.payload, conv: metaEvents.conversionData, at: metaEvents.sentAt })
    .from(metaEvents).where(and(eq(metaEvents.tenantId, t.id), eq(metaEvents.eventType, 'conversacion')));
  let hitFbc = 0, hitFbp = 0; const matchedIds = new Set<string>();
  for (const c of convs as any[]) {
    const blob = JSON.stringify(c.payload ?? '') + JSON.stringify(c.conv ?? '');
    let hit = false;
    for (const f of fbcs) if (f && blob.includes(f)) { hitFbc++; hit = true; break; }
    if (!hit) for (const f of fbps) if (f && blob.includes(f)) { hitFbp++; hit = true; break; }
    if (hit) matchedIds.add(c.id);
  }
  console.log(`\nConversaciones que matchean fbc/fbp de BL1: ${matchedIds.size}  (fbc=${hitFbc} fbp=${hitFbp})`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

import { and, eq, desc } from 'drizzle-orm';
import { db } from '@/db';
import { metaEvents, attributions } from '@/db/schema';
import { getTenantBySlug } from '@/lib/tenants';
async function main(){
  const t = await getTenantBySlug('king'); if(!t) throw new Error('no tenant');
  const lead = Number(process.argv[2]);
  const [ev] = await db.select().from(metaEvents).where(and(eq(metaEvents.tenantId,t.id), eq(metaEvents.eventId, `conv-${lead}`))).orderBy(desc(metaEvents.createdAt)).limit(1);
  console.log('EVENTO conversacion:', ev ? `${ev.eventName} status=${ev.status} type=${ev.eventType} campaign=${ev.campaignId}` : '(no encontrado)');
  const [attr] = await db.select().from(attributions).where(and(eq(attributions.tenantId,t.id), eq(attributions.matchedLeadId, lead))).limit(1);
  console.log('ATRIBUCION matcheada:', attr ? `code=${attr.code} campaign=${attr.campaignId} bono=${attr.bono} fbc=${attr.fbc?'sí':'no'} fbp=${attr.fbp?'sí':'no'} fbclid=${attr.fbclid?'sí':'no'}` : '(no matcheada)');
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1);});

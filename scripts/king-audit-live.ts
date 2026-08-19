import { and, eq, gte, sql, desc } from 'drizzle-orm';
import { db } from '@/db';
import { metaEvents, chatSessions, kommoWebhookLog } from '@/db/schema';
import { getTenantBySlug } from '@/lib/tenants';
async function main(){
  const t = await getTenantBySlug('king'); if(!t) throw new Error('no tenant');
  console.log('tenant id:', t.id, '| pixel:', t.metaPixelId, '| tiene capi token:', !!t.metaCapiToken);

  const since = new Date(Date.now() - 6*3600_000); // últimas 6hs
  const evs = await db.select().from(metaEvents).where(and(eq(metaEvents.tenantId, t.id), gte(metaEvents.createdAt, since))).orderBy(desc(metaEvents.createdAt));
  console.log('\nmetaEvents últimas 6hs:', evs.length);
  for (const e of evs.slice(0,20)) console.log(' ', e.createdAt, '|', e.eventType, '|', e.status, '|', e.campaignId);

  const sess = await db.select().from(chatSessions).where(and(eq(chatSessions.tenantId, t.id), gte(chatSessions.createdAt, since))).orderBy(desc(chatSessions.createdAt));
  console.log('\nchat_sessions últimas 6hs:', sess.length);
  for (const s of sess) console.log(' ', s.createdAt, '|', s.name, '|', s.phone, '|', s.step, '| lead:', s.kommoLeadId);

  const wh = await db.select().from(kommoWebhookLog).where(and(eq(kommoWebhookLog.tenantId, t.id), gte(kommoWebhookLog.receivedAt, since))).orderBy(desc(kommoWebhookLog.receivedAt));
  console.log('\nkommo_webhook_log últimas 6hs:', wh.length);
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1);});

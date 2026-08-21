/**
 * Limpia datos de testeo de bblack antes de prender ads en serio.
 *
 * - Borra TODAS las chat_sessions del tenant (Kommo lead + comprobante en disco).
 * - Borra meta_events de los días indicados (stats reportes → 0).
 * - Borra partner_operations del tenant (cargas/retiros de prueba).
 *
 * Uso:
 *   npx tsx scripts/purge-bblack-test-data.ts           # preview
 *   npx tsx scripts/purge-bblack-test-data.ts --confirm # ejecutar
 */
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { chatSessions, metaEvents, partnerOperations } from '@/db/schema';
import { purgeChatSession } from '@/lib/chat/deleteSession';
import { deleteKommoLead } from '@/lib/kommo';
import { getTenantBySlug } from '@/lib/tenants';

const SLUG = 'bblack';
const DAYS = ['2026-08-20', '2026-08-21'];
const AR = 'America/Argentina/Buenos_Aires';
const confirm = process.argv.includes('--confirm');

async function main() {
  const tenant = await getTenantBySlug(SLUG);
  if (!tenant) throw new Error(`no tenant ${SLUG}`);

  const dayExpr = sql<string>`to_char(${metaEvents.sentAt} AT TIME ZONE ${sql.raw(`'${AR}'`)}, 'YYYY-MM-DD')`;

  const dayIn = sql`${dayExpr} in ('2026-08-20','2026-08-21')`;

  const sessions = await db.select().from(chatSessions).where(eq(chatSessions.tenantId, tenant.id));
  const evPreview = await db
    .select({ day: dayExpr, type: metaEvents.eventType, n: sql<number>`count(*)::int` })
    .from(metaEvents)
    .where(and(eq(metaEvents.tenantId, tenant.id), dayIn))
    .groupBy(dayExpr, metaEvents.eventType);

  const [opsN] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(partnerOperations)
    .where(eq(partnerOperations.tenantId, tenant.id));

  console.log(`\n=== PURGE ${SLUG} ${confirm ? '(EJECUTANDO)' : '(PREVIEW — agregar --confirm)'} ===\n`);
  console.log(`Chat sessions a borrar: ${sessions.length}`);
  console.log('Por campaña:', JSON.stringify(
    sessions.reduce<Record<string, number>>((acc, s) => {
      const k = s.campaign ?? '(sin campaña)';
      acc[k] = (acc[k] ?? 0) + 1;
      return acc;
    }, {}),
  ));
  console.log('meta_events a borrar:', JSON.stringify(evPreview));
  console.log(`partner_operations a borrar: ${opsN?.n ?? 0}`);

  if (!confirm) {
    console.log('\n→ Corré con --confirm para aplicar.\n');
    process.exit(0);
  }

  let kommoOk = 0;
  let kommoFail = 0;
  for (const s of sessions) {
    if (s.kommoLeadId) {
      const ok = await deleteKommoLead(tenant, s.kommoLeadId);
      if (ok) kommoOk++;
      else kommoFail++;
    }
    await purgeChatSession(s.id, s.data as Record<string, unknown> | null);
  }

  const evDel = await db
    .delete(metaEvents)
    .where(and(eq(metaEvents.tenantId, tenant.id), dayIn))
    .returning({ id: metaEvents.id });

  const opsDel = await db
    .delete(partnerOperations)
    .where(eq(partnerOperations.tenantId, tenant.id))
    .returning({ id: partnerOperations.id });

  console.log(`\n✓ chat_sessions borradas: ${sessions.length}`);
  console.log(`✓ kommo leads borrados: ${kommoOk} (fallos: ${kommoFail})`);
  console.log(`✓ meta_events borrados: ${evDel.length}`);
  console.log(`✓ partner_operations borradas: ${opsDel.length}`);
  console.log('\nListo — reportes 20/21 en 0, bandeja vacía para tráfico real.\n');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

import { and, eq, sql, isNotNull } from 'drizzle-orm';
import { db } from '@/db';
import { metaEvents, attributions } from '@/db/schema';
import { getTenantBySlug } from '@/lib/tenants';

const AR = 'America/Argentina/Buenos_Aires';
async function main() {
  const slug = process.argv[2] ?? 'mooneyatkinson';
  const campaign = process.argv[3] ?? 'BL1';
  const t = await getTenantBySlug(slug);
  if (!t) throw new Error('no tenant');
  console.log(`# MÉTRICAS ${slug} — campaña ${campaign}\n`);

  // 1) Funnel por tipo de evento (TODA la cuenta)
  const totAll = await db
    .select({ type: metaEvents.eventType, n: sql<number>`count(*)::int` })
    .from(metaEvents).where(eq(metaEvents.tenantId, t.id)).groupBy(metaEvents.eventType);
  console.log('== Cuenta completa (todos los eventos) ==');
  for (const r of totAll) console.log(`  ${r.type}: ${r.n}`);

  // 2) Funnel de la campaña BL1
  const totCamp = await db
    .select({ type: metaEvents.eventType, n: sql<number>`count(*)::int` })
    .from(metaEvents).where(and(eq(metaEvents.tenantId, t.id), eq(metaEvents.campaignId, campaign))).groupBy(metaEvents.eventType);
  const cm: Record<string, number> = {};
  for (const r of totCamp) cm[r.type ?? '?'] = r.n;
  console.log(`\n== Campaña ${campaign} ==`);
  const conv = cm['conversacion'] ?? 0, carg = cm['cargo'] ?? 0, red = cm['redirect'] ?? 0;
  console.log(`  Redirects (visitas landing): ${red}`);
  console.log(`  Conversaciones (chats):      ${conv}`);
  console.log(`  Cargas (depósitos):          ${carg}`);
  console.log(`  Conversión (cargas/chats):   ${conv ? (100 * carg / conv).toFixed(1) : 0}%`);
  console.log(`  Chat/visita:                 ${red ? (100 * conv / red).toFixed(1) : 0}%`);

  // 3) Todas las campañas (contexto)
  const byCamp = await db
    .select({ camp: metaEvents.campaignId, type: metaEvents.eventType, n: sql<number>`count(*)::int` })
    .from(metaEvents).where(eq(metaEvents.tenantId, t.id)).groupBy(metaEvents.campaignId, metaEvents.eventType);
  const camps: Record<string, Record<string, number>> = {};
  for (const r of byCamp) { const k = r.camp ?? '(sin campaña)'; camps[k] ??= {}; camps[k][r.type ?? '?'] = r.n; }
  console.log('\n== Por campaña (todas) ==');
  for (const k of Object.keys(camps).sort()) {
    const c = camps[k]; console.log(`  ${k}: chats=${c['conversacion'] ?? 0} cargas=${c['cargo'] ?? 0} redirects=${c['redirect'] ?? 0}`);
  }

  // 4) Día a día de la campaña BL1 (hora AR)
  const evDay = sql<string>`to_char(${metaEvents.sentAt} AT TIME ZONE ${sql.raw(`'${AR}'`)}, 'YYYY-MM-DD')`;
  const daily = await db
    .select({ day: evDay, type: metaEvents.eventType, n: sql<number>`count(*)::int` })
    .from(metaEvents).where(and(eq(metaEvents.tenantId, t.id), eq(metaEvents.campaignId, campaign))).groupBy(evDay, metaEvents.eventType).orderBy(evDay);
  const dmap: Record<string, Record<string, number>> = {};
  for (const r of daily) { if (!r.day) continue; dmap[r.day] ??= {}; dmap[r.day][r.type ?? '?'] = r.n; }
  console.log(`\n== ${campaign} día a día ==`);
  console.log('  fecha       chats  cargas  conv%');
  for (const d of Object.keys(dmap).sort()) {
    const c = dmap[d]; const ch = c['conversacion'] ?? 0, ca = c['cargo'] ?? 0;
    console.log(`  ${d}   ${String(ch).padStart(4)}   ${String(ca).padStart(4)}   ${ch ? (100 * ca / ch).toFixed(1) : '0'}%`);
  }

  // 5) Atribuciones (visitas con token) por ccpp/campaña + match
  const attr = await db
    .select({ ccpp: attributions.ccpp, camp: attributions.campaignId, bono: attributions.bono,
      total: sql<number>`count(*)::int`, matched: sql<number>`count(${attributions.matchedLeadId})::int` })
    .from(attributions).where(eq(attributions.tenantId, t.id)).groupBy(attributions.ccpp, attributions.campaignId, attributions.bono);
  console.log('\n== Atribuciones (visitas con token) por ccpp/campaña ==');
  for (const r of attr) console.log(`  ccpp=${r.ccpp ?? '-'} camp=${r.camp ?? '-'} bono=${r.bono ?? '-'}: visitas=${r.total} matcheadas=${r.matched}`);

  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

// Backfill del campaign en el tracker: completa metaEvents.campaignId de las
// conversaciones que quedaron sin campaña (campaign null), usando la atribución
// que YA tenemos ligada al lead. NO toca Meta (no re-envía nada); solo corrige
// nuestras métricas internas.
//
//   npm run backfill-campaign -- <slug>            (dry-run: solo muestra)
//   npm run backfill-campaign -- <slug> --apply    (aplica el UPDATE)
//
// Fuentes de campaign, en orden: (1) attributions.matchedLeadId, (2) el campo
// utm_campaign espejado en leads, (3) el evento de carga hermano del mismo lead.
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '@/db';
import { tenants, metaEvents, attributions, leads } from '@/db/schema';

async function main() {
  const slug = process.argv[2];
  const apply = process.argv.includes('--apply');
  if (!slug) { console.error('Uso: npm run backfill-campaign -- <slug> [--apply]'); process.exit(1); }

  const [t] = await db.select().from(tenants).where(eq(tenants.slug, slug)).limit(1);
  if (!t) { console.error(`tenant ${slug} no existe`); process.exit(1); }

  // Conversaciones sin campaña.
  const pend = await db
    .select({ id: metaEvents.id, eventId: metaEvents.eventId, leadFk: metaEvents.leadId })
    .from(metaEvents)
    .where(and(
      eq(metaEvents.tenantId, t.id),
      eq(metaEvents.eventType, 'conversacion'),
      isNull(metaEvents.campaignId),
    ));

  console.log(`\n${slug}: ${pend.length} conversaciones sin campaña.\n`);
  if (!pend.length) process.exit(0);

  const plan: { id: string; leadId: number; campaign: string; via: string }[] = [];
  const unresolved: number[] = [];

  for (const ev of pend) {
    const leadId = Number(ev.eventId.replace(/^conv-/, ''));
    let campaign: string | null = null;
    let via = '';

    // (1) atribución matcheada a este lead
    const [attr] = await db
      .select({ c: attributions.campaignId })
      .from(attributions)
      .where(and(eq(attributions.tenantId, t.id), eq(attributions.matchedLeadId, leadId)))
      .limit(1);
    if (attr?.c) { campaign = attr.c; via = 'attribution'; }

    // (2) utm_campaign espejado en leads
    if (!campaign && ev.leadFk) {
      const [l] = await db.select({ c: leads.campaignId }).from(leads).where(eq(leads.id, ev.leadFk)).limit(1);
      if (l?.c) { campaign = l.c; via = 'lead.utm'; }
    }

    // (3) carga hermana del mismo lead
    if (!campaign) {
      const [cg] = await db
        .select({ c: metaEvents.campaignId })
        .from(metaEvents)
        .where(and(eq(metaEvents.tenantId, t.id), eq(metaEvents.eventId, `cargo-${leadId}`)))
        .limit(1);
      if (cg?.c) { campaign = cg.c; via = 'cargo-hermano'; }
    }

    if (campaign) plan.push({ id: ev.id, leadId, campaign, via });
    else unresolved.push(leadId);
  }

  // Resumen por campaña + fuente.
  const byCamp = new Map<string, number>();
  const byVia = new Map<string, number>();
  for (const p of plan) {
    byCamp.set(p.campaign, (byCamp.get(p.campaign) ?? 0) + 1);
    byVia.set(p.via, (byVia.get(p.via) ?? 0) + 1);
  }
  console.log('Resolubles:', plan.length, '| sin resolver:', unresolved.length);
  console.log('Por campaña:', Object.fromEntries(byCamp));
  console.log('Por fuente :', Object.fromEntries(byVia));
  if (unresolved.length) console.log('Leads sin resolver (primeros 15):', unresolved.slice(0, 15));

  if (!apply) {
    console.log('\n(dry-run) No se aplicó nada. Corré con --apply para ejecutar.');
    process.exit(0);
  }

  let done = 0;
  for (const p of plan) {
    await db.update(metaEvents).set({ campaignId: p.campaign }).where(eq(metaEvents.id, p.id));
    done++;
  }
  console.log(`\nAplicado: ${done} conversaciones actualizadas.`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

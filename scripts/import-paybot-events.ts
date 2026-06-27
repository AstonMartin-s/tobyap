// Importa eventos históricos del sistema PAYBOT original a nuestra tabla meta_events.
//   npm run import:paybot -- <slug> [startDate ISO] [endDate ISO]
// Ejemplo:
//   npm run import:paybot -- mooneyatkinson 2026-06-01T00:00:00.000Z 2026-06-27T23:59:59.999Z
// Sin fechas: trae todo el histórico (puede ser mucho).
import { getTenantBySlug } from '@/lib/tenants';
import { fetchConversions, type PaybotRecord } from '@/lib/paybot-external';
import { db } from '@/db';
import { metaEvents } from '@/db/schema';

function eventTypeOf(name?: string): string {
  if (!name) return 'other';
  if (name.startsWith('Conversacion')) return 'conversacion';
  if (name.startsWith('Cargo')) return 'cargo';
  return 'other';
}

async function main() {
  const [slug, startDate, endDate] = process.argv.slice(2);
  if (!slug) {
    console.error('Uso: npm run import:paybot -- <slug> [startDate] [endDate]');
    process.exit(1);
  }

  const tenant = await getTenantBySlug(slug);
  if (!tenant) {
    console.error(`Tenant "${slug}" no encontrado.`);
    process.exit(1);
  }

  console.log(`Importando ${slug} ${startDate ?? '(histórico completo)'} → ${endDate ?? ''} ...`);
  const data = await fetchConversions(tenant, { includeRecords: true, startDate, endDate });
  const records: PaybotRecord[] = data.records ?? [];
  console.log(`API: conv=${data.conversiones.count} cargas=${data.cargas.count} redirects=${data.totalRedirects} · records=${records.length}`);

  if (!records.length) {
    console.log('Sin records para importar.');
    process.exit(0);
  }

  const rows = records.map((r) => {
    const first = r.conversionData?.[0]?.data?.[0];
    const eventName = first?.event_name ?? 'unknown';
    const sentAt = first?.event_time ? new Date(first.event_time * 1000) : null;
    return {
      tenantId: tenant.id,
      eventName,
      eventId: `paybot:${r._id}`, // idempotente: el _id de Mongo es único
      eventType: eventTypeOf(eventName),
      status: r.success ? 'sent' : 'failed',
      success: r.success ?? null,
      conversionData: r.conversionData ?? null,
      messageData: r.messageData ?? null,
      extractedCode: r.extractedCode ?? null,
      response: r.conversionResults ?? null,
      campaignId: r.campaignId ?? null,
      metaCampaignId: r.metaCampaignId ?? null,
      metaCampaignName: r.metaCampaignName ?? null,
      metaAdId: r.metaAdId ?? null,
      metaAdName: r.metaAdName ?? null,
      sentAt,
    };
  });

  // Inserta en lotes, ignorando duplicados por (tenantId, eventId).
  let inserted = 0;
  const BATCH = 500;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const res = await db
      .insert(metaEvents)
      .values(chunk)
      .onConflictDoNothing({ target: [metaEvents.tenantId, metaEvents.eventId] })
      .returning({ id: metaEvents.id });
    inserted += res.length;
  }

  console.log(`✓ ${inserted} eventos importados (de ${rows.length}; duplicados omitidos).`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

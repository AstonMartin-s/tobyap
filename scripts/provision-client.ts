// Alta COMPLETA de un cliente nuevo desde un Kommo vacío:
//   1) Crea el embudo base + custom fields en el Kommo del cliente (provisión).
//   2) Descubre los IDs por nombre.
//   3) Crea el tenant en TOBYAP.
//
//   npm run provision -- tenants/<slug>.json
//
// JSON mínimo (mismo que onboarding):
//   slug, name, kommoSubdomain, kommoToken, metaPixelId, metaCapiToken,
//   eventSuffix, panelUser, panelPassword   (opcional: pipelineName, settings...)
import { readFileSync } from 'fs';
import { provisionClient } from '@/lib/kommo-provision';
import { discoverKommoConfig } from '@/lib/kommo-onboard';
import { upsertTenant } from '@/lib/tenants';
import type { CreateTenantInput } from '@/lib/types';

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('Uso: npm run provision -- tenants/<slug>.json');
    process.exit(1);
  }
  const input = JSON.parse(readFileSync(file, 'utf8')) as CreateTenantInput & { pipelineName?: string };
  for (const req of ['slug', 'name', 'kommoSubdomain', 'kommoToken'] as const) {
    if (!input[req]) {
      console.error(`Falta campo requerido: ${req}`);
      process.exit(1);
    }
  }

  console.log(`1) Provisionando Kommo de ${input.kommoSubdomain} ...`);
  const prov = await provisionClient(input.kommoSubdomain!, input.kommoToken!, {
    pipelineName: input.pipelineName,
  });
  console.log(`   Pipeline: ${prov.pipelineName} (${prov.pipelineId}) · estados creados: ${prov.created.statuses}`);
  console.log(`   Clientes Regulares: ${prov.regularesPipelineId} ${prov.created.regulares ? '(creado)' : '(ya existía)'}`);
  console.log(`   Custom fields creados: ${prov.created.fields.join(', ') || '(ninguno, ya existían)'}`);

  console.log('2) Descubriendo config (mapeo por nombre) ...');
  const cfg = await discoverKommoConfig(input.kommoSubdomain!, input.kommoToken!, {
    pipelineName: prov.pipelineName,
  });
  console.log(`   Cargo: ${cfg.statusCargo} · Revisar imagen: ${cfg.statusRevisarImagen}`);
  console.log(`   Custom fields: ${JSON.stringify(cfg.customFields)}`);
  if (cfg.warnings.length) cfg.warnings.forEach((w) => console.log(`   ⚠️  ${w}`));

  console.log('3) Creando tenant en TOBYAP ...');
  const row = await upsertTenant({
    ...input,
    kommoPipelineId: cfg.pipelineId,
    customFields: { ...cfg.customFields, ...(input.customFields ?? {}) },
  });

  console.log(`✓ Cliente "${row.slug}" listo.`);
  console.log('   Configurá en el Kommo del cliente los webhooks/bots:');
  console.log(`     webhook conversaciones:  /api/webhooks/kommo/${row.slug}`);
  console.log(`     bot CARGO  send_hook:    /api/conversion-event/${row.slug}`);
  console.log(`     bot CBU    send_hook:    /api/cbu/${row.slug}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

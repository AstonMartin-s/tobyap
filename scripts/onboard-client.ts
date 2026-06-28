// Onboarding de un cliente nuevo: descubre pipeline/estados/custom-fields de Kommo
// por NOMBRE y crea el tenant. El JSON solo necesita lo esencial (sin IDs).
//
//   npm run onboard -- tenants/<slug>.json
//
// JSON esperado (campos esenciales):
//   slug, name, kommoSubdomain, kommoToken, metaPixelId, metaCapiToken,
//   eventSuffix, panelUser, panelPassword
//   (opcionales) kommoEmail, openaiApiKey, pipelineName, pipelineId,
//                apiUrl, externalApiKey, settings, numbers
import { readFileSync } from 'fs';
import { discoverKommoConfig } from '@/lib/kommo-onboard';
import { upsertTenant } from '@/lib/tenants';
import type { CreateTenantInput } from '@/lib/types';

interface OnboardInput extends CreateTenantInput {
  pipelineName?: string;
  pipelineId?: number;
}

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('Uso: npm run onboard -- tenants/<slug>.json');
    process.exit(1);
  }
  const input = JSON.parse(readFileSync(file, 'utf8')) as OnboardInput;

  for (const req of ['slug', 'name', 'kommoSubdomain', 'kommoToken'] as const) {
    if (!input[req]) {
      console.error(`Falta campo requerido: ${req}`);
      process.exit(1);
    }
  }

  console.log(`Descubriendo config de Kommo para ${input.kommoSubdomain} ...`);
  const cfg = await discoverKommoConfig(input.kommoSubdomain!, input.kommoToken!, {
    pipelineName: input.pipelineName,
    pipelineId: input.pipelineId,
  });

  console.log(`  Pipeline: ${cfg.pipelineName} (${cfg.pipelineId})`);
  console.log(`  Cargo: ${cfg.statusCargo} · Revisar imagen: ${cfg.statusRevisarImagen}`);
  console.log(`  Custom fields: ${JSON.stringify(cfg.customFields)}`);
  if (cfg.warnings.length) cfg.warnings.forEach((w) => console.log(`  ⚠️  ${w}`));

  // Merge: lo descubierto + lo que ya venga en el JSON (el JSON pisa si está).
  const tenantInput: CreateTenantInput = {
    ...input,
    kommoPipelineId: input.kommoPipelineId ?? cfg.pipelineId,
    customFields: { ...cfg.customFields, ...(input.customFields ?? {}) },
  };

  const row = await upsertTenant(tenantInput);
  console.log(`✓ Cliente "${row.slug}" dado de alta (id: ${row.id}).`);
  console.log(`  Webhook Kommo: /api/webhooks/kommo/${row.slug}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

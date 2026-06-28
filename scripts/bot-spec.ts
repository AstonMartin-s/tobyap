// Imprime la guía EXACTA de ajuste de bots en el diseñador de Kommo para un cliente:
// URLs de send_hook + IDs de estados + IDs de custom fields del CBU.
//
//   npm run bot-spec -- <slug>
import { getTenantBySlug } from '@/lib/tenants';
import { fetchPipelineStatuses } from '@/lib/kommo';

const APP = 'https://tobyap-production.up.railway.app';

async function main() {
  const slug = process.argv[2];
  if (!slug) {
    console.error('Uso: npm run bot-spec -- <slug>');
    process.exit(1);
  }
  const t = await getTenantBySlug(slug);
  if (!t) {
    console.error(`Tenant "${slug}" no encontrado.`);
    process.exit(1);
  }

  const statuses = t.kommoPipelineId ? await fetchPipelineStatuses(t, t.kommoPipelineId) : [];
  const byName = (re: RegExp) => statuses.find((s) => re.test(s.name))?.id ?? '(no encontrado)';

  const cf = t.customFields;
  console.log(`\n=== Ajuste de bots para "${slug}" (pipeline ${t.kommoPipelineId}) ===\n`);

  console.log('SEND_HOOK (acción "Enviar webhook" en cada bot):');
  console.log(`  CARGO  →  ${APP}/api/conversion-event/${slug}`);
  console.log(`  CBU    →  ${APP}/api/cbu/${slug}`);
  console.log('');

  console.log('MENSAJE del bot CBU (variables a insertar):');
  console.log(`  CBU:      {{lead.cf.${cf.cbu_field ?? '?'}}}`);
  console.log(`  Titular:  {{lead.cf.${cf.titular_field ?? '?'}}}`);
  console.log('');

  console.log('CAMBIOS DE ESTADO (change_status -> usar estos IDs del embudo nuevo):');
  console.log(`  Incoming leads:  ${byName(/incoming/i)}`);
  console.log(`  Revisar:         ${byName(/^revisar$/i)}`);
  console.log(`  Pidio Usuario:   ${byName(/pidio usuario/i)}`);
  console.log(`  Pidio CbuAlias:  ${byName(/pidio cbu/i)}`);
  console.log(`  Revisar imagen:  ${byName(/revisar imagen/i)}  (cf: ${cf.status_revisar_imagen ?? '?'})`);
  console.log(`  Cargo$:          ${byName(/^cargo/i)}  (cf: ${cf.status_cargo ?? '?'})`);
  console.log(`  No Atender:      ${byName(/no atender/i)}`);
  console.log(`  No Cargo:        ${byName(/no cargo/i)}`);
  console.log(`  Seguimiento:     ${byName(/seguimiento/i)}`);
  console.log('');

  console.log('WEBHOOK de Kommo (Ajustes → Webhooks) — ya suscripto por API:');
  console.log(`  ${APP}/api/webhooks/kommo/${slug}  (add_lead, status_lead)`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

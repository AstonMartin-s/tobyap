// Deja un cliente con TODO el setup estándar de TOBYAP (campos + etapas + mapeos),
// idempotente. También se ejecuta solo al crear un cliente desde el deploy del panel.
//   npm run heal-client -- <slug>
import { healClient } from '@/lib/heal';

async function main() {
  const slug = process.argv[2];
  if (!slug) { console.error('Uso: npm run heal-client -- <slug>'); process.exit(1); }
  const r = await healClient(slug);
  console.log(`\n=== heal ${slug} ===`);
  console.log('campos creados:', r.fieldsCreated.length ? r.fieldsCreated.join(', ') : '(ya existían)');
  console.log('etapas creadas:', r.stagesCreated.length ? r.stagesCreated.join(', ') : '(ya estaban)');
  console.log('mapeo:', r.mapping);
  if (r.warnings.length) console.log('⚠️', r.warnings.join(' | '));
  console.log('\n✅ listo. Kommo-side manual: webhooks, routing del pipeline entrante, bots.');
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

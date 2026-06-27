// Alta de tenant desde la consola: npm run seed:tenant -- tenants/<slug>.json
// El archivo JSON tiene la forma de CreateTenantInput (con secretos en claro,
// SOLO local — el script los cifra al insertar). No commitear archivos con tokens.
import { readFileSync } from 'fs';
import { upsertTenant } from '@/lib/tenants';
import type { CreateTenantInput } from '@/lib/types';

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('Uso: npm run seed:tenant -- tenants/<slug>.json');
    process.exit(1);
  }

  const input = JSON.parse(readFileSync(file, 'utf8')) as CreateTenantInput;
  if (!input.slug || !input.name) {
    console.error('El JSON necesita al menos slug y name.');
    process.exit(1);
  }

  const row = await upsertTenant(input);
  console.log(`✓ Tenant "${row.slug}" cargado (id: ${row.id}).`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

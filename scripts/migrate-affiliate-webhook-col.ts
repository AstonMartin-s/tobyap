// Migración aditiva: agrega tenants.affiliate_webhook_secret (cifrado, nullable).
// Debe correr ANTES de deployar el código nuevo (el schema Drizzle ya la referencia
// en getTenantBySlug). Es idempotente y 100% compatible con el código viejo.
import { sql } from 'drizzle-orm';
import { db } from '../db';

async function main() {
  await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS affiliate_webhook_secret TEXT`);
  const [{ exists }] = (await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'tenants' AND column_name = 'affiliate_webhook_secret'
    ) AS exists
  `)) as unknown as Array<{ exists: boolean }>;
  console.log('affiliate_webhook_secret column exists:', exists);
  process.exit(exists ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

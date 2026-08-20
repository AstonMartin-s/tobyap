import { db } from '@/db';
import { sql } from 'drizzle-orm';

// Agrega columnas de Partner API (bblack/KingPlay) al tenant. Idempotente.
async function main() {
  await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS provider text DEFAULT 'pagoda'`);
  await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS partner_api_url text`);
  await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS partner_api_key text`);
  console.log('OK: columnas provider / partner_api_url / partner_api_key agregadas');
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});

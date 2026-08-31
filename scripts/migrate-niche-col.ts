// Migración aditiva: agrega tenants.niche (text, default 'circo'). Idempotente y
// 100% compatible con el código viejo (clientes existentes quedan en 'circo').
// Debe correr ANTES de deployar/usar el código de nichos (schema ya lo referencia).
import { sql } from 'drizzle-orm';
import { db } from '../db';

async function main() {
  await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS niche TEXT DEFAULT 'circo'`);
  const [{ exists }] = (await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'tenants' AND column_name = 'niche'
    ) AS exists
  `)) as unknown as Array<{ exists: boolean }>;
  console.log('niche column exists:', exists);
  process.exit(exists ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

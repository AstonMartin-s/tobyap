// Columna aditiva: copia cifrada de la clave de panel, para copiarla desde
// el admin sin mostrarla. El hash bcrypt queda igual y no se puede revertir.
import { sql } from 'drizzle-orm';
import { db } from '../db';

async function main() {
  await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS panel_password_enc TEXT`);
  const [{ exists }] = (await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'tenants' AND column_name = 'panel_password_enc'
    ) AS exists
  `)) as unknown as Array<{ exists: boolean }>;
  console.log('panel_password_enc exists:', exists);
  process.exit(exists ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

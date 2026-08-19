import { db } from '@/db';
import { sql } from 'drizzle-orm';
async function main(){
  await db.execute(sql`ALTER TABLE landings ADD COLUMN IF NOT EXISTS alias text`);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS landings_alias_unique ON landings (alias) WHERE alias IS NOT NULL`);
  console.log('OK: columna alias + índice único agregados (NULLs no chocan)');
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1);});

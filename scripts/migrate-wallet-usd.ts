import { sql } from 'drizzle-orm';
import { db } from '../db';

async function main() {
  await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS wallet_usd double precision`);
  console.log('wallet_usd ok');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });

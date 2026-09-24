import { sql } from 'drizzle-orm';
import { db } from '../db';

async function main() {
  await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS wallet_usd double precision`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS ops_wallet (
      id text PRIMARY KEY DEFAULT 'main',
      amount double precision,
      updated_at timestamptz DEFAULT now()
    )
  `);
  console.log('wallet ok');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });

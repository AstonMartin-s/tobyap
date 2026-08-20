import { db } from '@/db';
import { sql } from 'drizzle-orm';

// Crea la tabla partner_operations (cargas/retiros vía Partner API). Idempotente.
async function main() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS partner_operations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      session_id uuid,
      username text NOT NULL,
      type text NOT NULL,
      amount double precision NOT NULL,
      reference text NOT NULL UNIQUE,
      bonus_percent integer,
      ledger_id bigint,
      balance_after double precision,
      operator text,
      status text DEFAULT 'pending',
      error text,
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now()
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS partner_ops_tenant_user ON partner_operations (tenant_id, username)`);
  console.log('OK: tabla partner_operations + índice creados');
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

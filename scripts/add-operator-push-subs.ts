// Tabla de suscripciones Web Push del OPERADOR (panel). Idempotente.
// Solo la usan tenants provider='manual' (goldenC / ElGanador).
import { sql } from 'drizzle-orm';
import { db } from '@/db';

async function main() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS operator_push_subs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      panel_user text,
      endpoint text NOT NULL,
      subscription jsonb NOT NULL,
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS operator_push_tenant_endpoint
    ON operator_push_subs (tenant_id, endpoint)
  `);
  console.log('OK: operator_push_subs lista');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

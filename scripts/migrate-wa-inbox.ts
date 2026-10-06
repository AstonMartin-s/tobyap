// Migración aditiva para el inbox de WhatsApp no-API (vía Blaster). Idempotente.
//   - chat_sessions.channel TEXT DEFAULT 'livechat'
//   - tenants.blaster_base_url / blaster_session_id / blaster_token / wa_inbound_secret
import { sql } from 'drizzle-orm';
import { db } from '../db';

async function main() {
  await db.execute(sql`ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS channel TEXT DEFAULT 'livechat'`);
  await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS blaster_base_url TEXT`);
  await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS blaster_session_id TEXT`);
  await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS blaster_session_ids JSONB DEFAULT '[]'::jsonb`);
  await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS blaster_token TEXT`);
  await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS wa_inbound_secret TEXT`);

  const cols = (await db.execute(sql`
    SELECT column_name FROM information_schema.columns
    WHERE (table_name = 'chat_sessions' AND column_name = 'channel')
       OR (table_name = 'tenants' AND column_name IN ('blaster_base_url','blaster_session_id','blaster_session_ids','blaster_token','wa_inbound_secret'))
  `)) as unknown as Array<{ column_name: string }>;
  const list = Array.isArray(cols) ? cols : [];
  console.log('columnas creadas/presentes:', list.map((c) => c.column_name).sort().join(', '));
  process.exit(list.length >= 6 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

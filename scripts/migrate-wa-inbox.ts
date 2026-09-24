// Migración aditiva para el inbox de WhatsApp no-API (vía Blaster). Idempotente y
// 100% compatible con el código viejo:
//   - chat_sessions.channel TEXT DEFAULT 'livechat' (todo lo existente queda livechat)
//   - tenants.blaster_base_url / blaster_session_id / blaster_token / wa_inbound_secret
// Debe correr ANTES de deployar/usar el código del inbox WhatsApp.
import { sql } from 'drizzle-orm';
import { db } from '../db';

async function main() {
  await db.execute(sql`ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS channel TEXT DEFAULT 'livechat'`);
  await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS blaster_base_url TEXT`);
  await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS blaster_session_id TEXT`);
  await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS blaster_token TEXT`);
  await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS wa_inbound_secret TEXT`);

  const cols = (await db.execute(sql`
    SELECT column_name FROM information_schema.columns
    WHERE (table_name = 'chat_sessions' AND column_name = 'channel')
       OR (table_name = 'tenants' AND column_name IN ('blaster_base_url','blaster_session_id','blaster_token','wa_inbound_secret'))
  `)) as unknown as Array<{ column_name: string }>;
  console.log('columnas creadas/presentes:', cols.map((c) => c.column_name).sort().join(', '));
  process.exit(cols.length >= 5 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

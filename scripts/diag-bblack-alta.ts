import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { getTenantBySlug } from '@/lib/tenants';
import { getConfig, getPlayer } from '@/lib/partner-api';

// Diagnóstico READ-ONLY del alta de bblack: ¿de dónde salen los $10 iniciales?
// Nuestro alta solo crea el jugador (username/password/phone), no deposita. Este
// script confirma si el saldo por defecto viene de la config del agente en la
// plataforma (Partner API) leyendo /config y el balance de usuarios recién
// creados. NO escribe nada.
//
// Uso: npx tsx --env-file=.env scripts/diag-bblack-alta.ts [slug]
async function main() {
  const slug = process.argv[2] || 'bblack';
  const t = await getTenantBySlug(slug);
  if (!t) throw new Error(`tenant ${slug} no existe`);
  console.log(`\n=== Diagnóstico alta ${slug} (provider=${t.provider}) ===\n`);

  // 1) Config del agente en la plataforma (puede traer bono/saldo de bienvenida).
  try {
    const cfg = await getConfig(t);
    console.log('GET /config →');
    console.log(JSON.stringify(cfg, null, 2));
  } catch (e) {
    console.log('GET /config ERROR:', e instanceof Error ? e.message : String(e));
  }

  // 2) Balance de los últimos usuarios creados (para ver si nacen con saldo > 0).
  const rows = (await db.execute(sql`
    SELECT data->>'username' AS username, created_at
    FROM chat_sessions
    WHERE tenant_id = ${t.id}
      AND data->>'username' IS NOT NULL
    ORDER BY created_at DESC
    LIMIT 5
  `)) as unknown as Array<{ username: string; created_at: string }>;

  console.log(`\n--- Balance de ${rows.length} usuarios recientes ---`);
  for (const r of rows) {
    try {
      const p = await getPlayer(t, r.username);
      console.log(`${r.username}\tbalance=${p.balance}\tcreated=${r.created_at}`);
    } catch (e) {
      console.log(`${r.username}\tERROR ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  console.log('\n(FIN — read-only, no se escribió nada)\n');
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

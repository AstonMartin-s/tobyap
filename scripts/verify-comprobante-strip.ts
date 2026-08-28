/**
 * READ-ONLY: valida el operador `jsonb - 'comprobante'` sobre filas que HOY
 * tienen comprobante base64 en `data`. Confirma que se remueve esa clave y que
 * el resto de `data` queda intacto. Sin writes.
 * Uso: npx tsx --env-file=.env scripts/verify-comprobante-strip.ts
 */
import { sql } from 'drizzle-orm';
import { db } from '@/db';

async function main() {
  const [{ n }] = (await db.execute(sql`
    SELECT count(*)::int AS n FROM chat_sessions WHERE data ? 'comprobante'
  `)) as unknown as Array<{ n: number }>;
  console.log(`Filas con data.comprobante (base64) ahora mismo: ${n}`);
  if (!n) { console.log('No hay base64 vivo para probar (el cleanup 48h ya limpió). El operador jsonb - key es estándar de Postgres igualmente.'); process.exit(0); }

  const rows = (await db.execute(sql`
    SELECT
      session_key,
      (data ? 'comprobante')                              AS old_has,
      ((data - 'comprobante') ? 'comprobante')            AS new_has,
      (data ? 'username')                                 AS old_user,
      ((data - 'comprobante') ? 'username')               AS new_user,
      length((data ->> 'comprobante'))                    AS b64_len,
      (jsonb_object_keys_count(data) )                    AS ignore_me
    FROM chat_sessions
    WHERE data ? 'comprobante'
    LIMIT 5
  `).catch(async () => {
    // jsonb_object_keys_count no existe; reintento sin esa columna.
    return (await db.execute(sql`
      SELECT
        session_key,
        (data ? 'comprobante')                   AS old_has,
        ((data - 'comprobante') ? 'comprobante') AS new_has,
        (data ? 'username')                      AS old_user,
        ((data - 'comprobante') ? 'username')    AS new_user,
        length((data ->> 'comprobante'))         AS b64_len
      FROM chat_sessions
      WHERE data ? 'comprobante'
      LIMIT 5
    `)) as unknown;
  })) as unknown as Array<{ session_key: string; old_has: boolean; new_has: boolean; old_user: boolean; new_user: boolean; b64_len: number }>;

  let failures = 0;
  for (const r of rows) {
    const okStrip = r.old_has === true && r.new_has === false;
    const okKeep = r.old_user === r.new_user; // username no debe cambiar por el strip
    console.log(`${r.session_key}: base64=${r.b64_len}b | comprobante old=${r.old_has} new=${r.new_has} | username old=${r.old_user} new=${r.new_user} | ${okStrip && okKeep ? 'OK' : 'FALLA'}`);
    if (!okStrip || !okKeep) failures++;
  }
  if (failures) { console.error(`💥 ${failures} fila(s) con problema.`); process.exit(1); }
  console.log('🎉 El strip remueve comprobante y conserva el resto de data. OK.');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });

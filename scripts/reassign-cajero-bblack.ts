import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { getTenantBySlug } from '@/lib/tenants';
import { listCajeros } from '@/lib/rotation';

// Reasigna las sesiones que tienen fijado (sticky) un cajero que se cayó/desactivó
// a los cajeros ACTIVOS restantes, round-robin. Idempotente y acotado: solo toca
// sesiones cuyo assignedWa == teléfono muerto. Los usuarios nuevos ya no se le
// asignan porque pickCajero filtra status=true; esto arregla las sesiones viejas.
//
// Uso: npx tsx --env-file=.env scripts/reassign-cajero-bblack.ts <telefonoMuerto> [slug]
//   ej: npx tsx --env-file=.env scripts/reassign-cajero-bblack.ts 5491125524704 bblack
async function main() {
  const deadRaw = process.argv[2];
  const slug = process.argv[3] || 'bblack';
  if (!deadRaw) throw new Error('falta el teléfono del cajero caído (arg 1)');
  const dead = deadRaw.replace(/\D/g, '');

  const t = await getTenantBySlug(slug);
  if (!t) throw new Error(`tenant ${slug} no existe`);

  // Cajeros activos (excluye el caído, que ya está status=false).
  const cajeros = (await listCajeros(t.id)).filter((c) => c.phone.replace(/\D/g, '') !== dead);
  if (!cajeros.length) throw new Error('no hay cajeros activos para reasignar');
  const n = cajeros.length;
  console.log(`Reasignando sticky del cajero muerto ${dead} → ${n} activos: ${cajeros.map((c) => c.name || c.phone).join(', ')}`);

  // Cuántas hay que mover.
  const [{ total }] = (await db.execute(sql`
    SELECT count(*)::int AS total FROM chat_sessions
    WHERE tenant_id = ${t.id} AND regexp_replace(coalesce(data->>'assignedWa',''), '\\D', '', 'g') = ${dead}
  `)) as unknown as Array<{ total: number }>;
  console.log(`Sesiones a reasignar: ${total}`);
  if (!total) { console.log('Nada que hacer.'); process.exit(0); }

  // UPDATE único round-robin: CASE por índice.
  const cases = cajeros
    .map((c, idx) => `WHEN ${idx} THEN '${JSON.stringify({ assignedWa: c.phone, assignedWaName: c.name ?? null }).replace(/'/g, "''")}'::jsonb`)
    .join(' ');

  const res = (await db.execute(sql`
    WITH ranked AS (
      SELECT id, (row_number() OVER (ORDER BY created_at)) - 1 AS rn
      FROM chat_sessions
      WHERE tenant_id = ${t.id}
        AND regexp_replace(coalesce(data->>'assignedWa',''), '\\D', '', 'g') = ${dead}
    )
    UPDATE chat_sessions cs
    SET data = coalesce(cs.data, '{}'::jsonb) || (CASE (ranked.rn % ${n}) ${sql.raw(cases)} END)
    FROM ranked
    WHERE cs.id = ranked.id
  `)) as unknown as { count?: number };

  console.log(`Listo. Reasignadas: ${res?.count ?? total}`);

  // Verificación post.
  const check:any = await db.execute(sql`
    SELECT data->>'assignedWaName' AS name, data->>'assignedWa' AS wa, count(*)
    FROM chat_sessions WHERE tenant_id = ${t.id} AND data->>'assignedWa' IS NOT NULL
    GROUP BY 1,2 ORDER BY 3 DESC
  `);
  console.log('\nDistribución final →');
  for (const c of check) console.log('  ', (c.name || '(sin nombre)').padEnd(12), c.wa, '→', c.count);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

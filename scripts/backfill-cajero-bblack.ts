import { eq, and, asc } from 'drizzle-orm';
import { db } from '@/db';
import { numbers, tenants } from '@/db/schema';
import { sql } from 'drizzle-orm';

// Backfill del cajero sticky para sesiones de bblack sin data.assignedWa.
// Reparte round-robin entre los 'cajero' activos en UN SOLO UPDATE (rápido).
//
// Uso: npx tsx --env-file=.env scripts/backfill-cajero-bblack.ts [slug]

async function main() {
  const slug = process.argv[2] || 'bblack';
  const t = await db.query.tenants.findFirst({ where: eq(tenants.slug, slug) });
  if (!t) throw new Error(`tenant ${slug} no existe`);

  const cajeros = (
    await db
      .select({ phone: numbers.phone, name: numbers.name })
      .from(numbers)
      .where(and(eq(numbers.tenantId, t.id), eq(numbers.type, 'cajero'), eq(numbers.status, true)))
      .orderBy(asc(numbers.createdAt))
  ).filter((c) => c.phone) as Array<{ phone: string; name: string | null }>;
  if (!cajeros.length) throw new Error('no hay cajeros activos');
  console.log(`Cajeros: ${cajeros.map((c) => c.name).join(', ')}`);

  const n = cajeros.length;
  // CASE que mapea (rn % n) -> json del cajero correspondiente.
  const cases = cajeros
    .map((c, idx) => `WHEN ${idx} THEN '${JSON.stringify({ assignedWa: c.phone, assignedWaName: c.name ?? null }).replace(/'/g, "''")}'::jsonb`)
    .join(' ');

  const res = await db.execute(sql`
    WITH ranked AS (
      SELECT id, (row_number() OVER (ORDER BY created_at)) - 1 AS rn
      FROM chat_sessions
      WHERE tenant_id = ${t.id} AND (data ->> 'assignedWa') IS NULL
    )
    UPDATE chat_sessions cs
    SET data = coalesce(cs.data, '{}'::jsonb) || (
      CASE (ranked.rn % ${n}) ${sql.raw(cases)} END
    )
    FROM ranked
    WHERE cs.id = ranked.id
  `);
  console.log('Backfill OK', (res as unknown as { rowCount?: number }).rowCount ?? '');
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

// Setea provider='manual' SOLO en goldenC y ElGanador.
// Idempotente. No toca fichas/API de nadie más.
import { inArray, sql } from 'drizzle-orm';
import { db } from '@/db';
import { tenants } from '@/db/schema';

const SLUGS = ['goldenc', 'elganador'];

async function main() {
  const rows = await db
    .select({ slug: tenants.slug, name: tenants.name, provider: tenants.provider })
    .from(tenants)
    .where(inArray(tenants.slug, SLUGS));
  console.log('antes:', rows);

  await db
    .update(tenants)
    .set({ provider: 'manual', updatedAt: new Date() })
    .where(inArray(tenants.slug, SLUGS));

  const after = await db
    .select({ slug: tenants.slug, name: tenants.name, provider: tenants.provider })
    .from(tenants)
    .where(inArray(tenants.slug, SLUGS));
  console.log('después:', after);

  const missing = SLUGS.filter((s) => !after.some((r) => r.slug === s));
  if (missing.length) {
    const like = await db.execute(sql`
      SELECT slug, name, provider FROM tenants
      WHERE slug ILIKE '%golden%' OR slug ILIKE '%ganador%' OR name ILIKE '%golden%' OR name ILIKE '%ganador%'
    `);
    console.log('no encontré:', missing, '· candidatos:', like);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

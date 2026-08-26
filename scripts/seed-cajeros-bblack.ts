import { eq, and } from 'drizzle-orm';
import { db } from '@/db';
import { numbers, tenants } from '@/db/schema';

// Carga (idempotente) los números de cajeros de bblack en la tabla numbers con
// categoría 'cajero'. Estos NO rotan en las landings (esas usan publi/soporte);
// se usan para el "cajero sticky" del chat: se asigna uno al crear el usuario y
// todas las derivaciones van siempre a ese mismo número.
//
// Uso: npx tsx --env-file=.env scripts/seed-cajeros-bblack.ts [slug]

const CAJEROS: Array<{ name: string; phone: string }> = [
  { name: 'Ariana 1', phone: '5491158471814' },
  { name: 'Ariana 2', phone: '5491125524704' },
  { name: 'Mateo 1', phone: '5491125528373' },
  { name: 'Mateo 2', phone: '5491125528513' },
];

async function main() {
  const slug = process.argv[2] || 'bblack';
  const t = await db.query.tenants.findFirst({ where: eq(tenants.slug, slug) });
  if (!t) throw new Error(`tenant ${slug} no existe`);

  for (const c of CAJEROS) {
    const existing = await db
      .select({ id: numbers.id })
      .from(numbers)
      .where(and(eq(numbers.tenantId, t.id), eq(numbers.phone, c.phone)))
      .limit(1);
    if (existing.length) {
      await db
        .update(numbers)
        .set({ name: c.name, type: 'cajero', status: true })
        .where(eq(numbers.id, existing[0].id));
      console.log(`  actualizado: ${c.name} (${c.phone})`);
    } else {
      await db.insert(numbers).values({ tenantId: t.id, name: c.name, phone: c.phone, type: 'cajero', status: true });
      console.log(`  insertado:  ${c.name} (${c.phone})`);
    }
  }

  const all = await db
    .select({ name: numbers.name, phone: numbers.phone, status: numbers.status })
    .from(numbers)
    .where(and(eq(numbers.tenantId, t.id), eq(numbers.type, 'cajero')));
  console.log(`\nCajeros 'cajero' de ${slug}:`, all);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

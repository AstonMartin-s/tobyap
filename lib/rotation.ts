import { and, asc, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { numbers, tenants } from '@/db/schema';

// Rotación ESTRICTA round-robin (1 a 1) entre los números ACTIVOS de una
// categoría (type) del tenant — la categoría es el tipo de la landing. Usa un
// cursor persistido (tenants.rotation_cursor) incrementado de forma atómica.
// Orden estable por fecha de alta. Si no hay números activos en esa categoría,
// devuelve null (la landing cae a su fallback / "no disponible").
export async function pickNumberByCategory(
  tenantId: string,
  category: string | null | undefined,
): Promise<string | null> {
  if (!category) return null;
  const rows = await db
    .select({ phone: numbers.phone })
    .from(numbers)
    .where(and(eq(numbers.tenantId, tenantId), eq(numbers.type, category), eq(numbers.status, true)))
    .orderBy(asc(numbers.createdAt));

  if (!rows.length) return null;
  if (rows.length === 1) return rows[0].phone;

  const [row] = await db
    .update(tenants)
    .set({ rotationCursor: sql`coalesce(${tenants.rotationCursor}, 0) + 1` })
    .where(eq(tenants.id, tenantId))
    .returning({ c: tenants.rotationCursor });

  const cursor = row?.c ?? 0;
  return rows[cursor % rows.length].phone;
}

// Compat: rotación entre los números 'publi' (categoría por defecto).
export async function pickPubliRotating(tenantId: string): Promise<string | null> {
  return pickNumberByCategory(tenantId, 'publi');
}

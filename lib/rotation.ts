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
  let rows = await db
    .select({ phone: numbers.phone })
    .from(numbers)
    .where(and(eq(numbers.tenantId, tenantId), eq(numbers.type, category), eq(numbers.status, true)))
    .orderBy(asc(numbers.createdAt));

  // Fallback: si la categoría pedida no tiene números activos (típico en
  // 'soporte' cuando el cliente sólo cargó cajeros), rotamos entre los 'cajero'
  // activos. Evita que la landing walink muestre "No disponible".
  if (!rows.length && category !== 'cajero') {
    rows = await db
      .select({ phone: numbers.phone })
      .from(numbers)
      .where(and(eq(numbers.tenantId, tenantId), eq(numbers.type, 'cajero'), eq(numbers.status, true)))
      .orderBy(asc(numbers.createdAt));
  }

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

// Igual que pickNumberByCategory pero devuelve teléfono + nombre. Se usa para el
// "cajero sticky": elegimos uno con el round-robin y lo fijamos al usuario.
export async function pickCajero(
  tenantId: string,
): Promise<{ phone: string; name: string | null } | null> {
  const rows = await db
    .select({ phone: numbers.phone, name: numbers.name })
    .from(numbers)
    .where(and(eq(numbers.tenantId, tenantId), eq(numbers.type, 'cajero'), eq(numbers.status, true)))
    .orderBy(asc(numbers.createdAt));

  const valid = rows.filter((r) => r.phone && String(r.phone).replace(/\D/g, ''));
  if (!valid.length) return null;
  if (valid.length === 1) return { phone: String(valid[0].phone), name: valid[0].name };

  const [row] = await db
    .update(tenants)
    .set({ rotationCursor: sql`coalesce(${tenants.rotationCursor}, 0) + 1` })
    .where(eq(tenants.id, tenantId))
    .returning({ c: tenants.rotationCursor });

  const cursor = row?.c ?? 0;
  const pick = valid[cursor % valid.length];
  return { phone: String(pick.phone), name: pick.name };
}

// Lista de cajeros activos (para el selector de reasignación manual en el panel).
export async function listCajeros(
  tenantId: string,
): Promise<Array<{ phone: string; name: string | null }>> {
  const rows = await db
    .select({ phone: numbers.phone, name: numbers.name })
    .from(numbers)
    .where(and(eq(numbers.tenantId, tenantId), eq(numbers.type, 'cajero'), eq(numbers.status, true)))
    .orderBy(asc(numbers.createdAt));
  return rows.filter((r) => r.phone).map((r) => ({ phone: String(r.phone), name: r.name }));
}

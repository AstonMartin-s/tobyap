import { and, asc, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { numbers, tenants } from '@/db/schema';

// Rotación ESTRICTA round-robin (1 a 1) entre los números publi activos del
// tenant. Usa un cursor persistido en tenants.rotation_cursor, incrementado de
// forma atómica (UPDATE ... RETURNING) para repartir parejo aún con requests
// concurrentes. Orden estable por fecha de alta.
export async function pickPubliRotating(tenantId: string): Promise<string | null> {
  const publi = await db
    .select({ phone: numbers.phone })
    .from(numbers)
    .where(and(eq(numbers.tenantId, tenantId), eq(numbers.type, 'publi'), eq(numbers.status, true)))
    .orderBy(asc(numbers.createdAt));

  if (!publi.length) return null;
  if (publi.length === 1) return publi[0].phone;

  const [row] = await db
    .update(tenants)
    .set({ rotationCursor: sql`coalesce(${tenants.rotationCursor}, 0) + 1` })
    .where(eq(tenants.id, tenantId))
    .returning({ c: tenants.rotationCursor });

  const cursor = row?.c ?? 0;
  return publi[cursor % publi.length].phone;
}

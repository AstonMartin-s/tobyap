import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { a3State } from '@/db/schema';
import { a3Lines, type A3Line } from './config';

// Rotación round-robin estricta (1 a 1) entre las líneas A3. Cursor propio en
// a3_state (aislado del rotationCursor de tenants). Incremento atómico.
export async function a3PickLine(): Promise<A3Line | null> {
  const lines = a3Lines();
  if (!lines.length) return null;
  if (lines.length === 1) return lines[0];
  const [row] = await db
    .insert(a3State)
    .values({ id: 1, rotationCursor: 1 })
    .onConflictDoUpdate({
      target: a3State.id,
      set: { rotationCursor: sql`coalesce(${a3State.rotationCursor}, 0) + 1` },
    })
    .returning({ c: a3State.rotationCursor });
  const cursor = row?.c ?? 0;
  return lines[cursor % lines.length];
}

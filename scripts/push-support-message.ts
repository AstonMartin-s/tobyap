import { and, eq, notInArray, gte, notLike } from 'drizzle-orm';
import { db } from '@/db';
import { chatSessions } from '@/db/schema';
import { getTenantBySlug } from '@/lib/tenants';

const SUPPORT_URL = 'https://wa.link/jugandoconking';

async function main() {
  const t = await getTenantBySlug('king'); if (!t) throw new Error('no tenant');
  const since = new Date('2026-08-17T20:00:00.000Z');
  const rows = await db.select().from(chatSessions).where(and(
    eq(chatSessions.tenantId, t.id),
    gte(chatSessions.createdAt, since),
    notInArray(chatSessions.step, ['done', 'closed']),
  ));
  const real = rows.filter((r) => !['TestFunnel', 'VerifyParam'].includes(r.name ?? ''));
  console.log('a actualizar:', real.length);

  const text = `¡Hola! 👋 Vimos que quedaste a mitad de camino. Escribinos por acá y te ayudamos a terminar 🙌\n${SUPPORT_URL}`;
  for (const r of real) {
    const messages = [...(r.messages ?? []), { from: 'bot' as const, text, at: Date.now() }];
    await db.update(chatSessions).set({ messages, updatedAt: new Date() }).where(eq(chatSessions.id, r.id));
    console.log('  actualizado:', r.name, r.phone);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

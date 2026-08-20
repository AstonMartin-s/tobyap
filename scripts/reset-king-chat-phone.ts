/**
 * Borra la sesión de chat de un teléfono en King (arrancar de cero).
 * Uso: npx tsx --env-file=.env scripts/reset-king-chat-phone.ts --phone 3541307465
 */
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { chatSessions } from '@/db/schema';
import { normalizeAr } from '@/lib/chat/wachecker';
import { getTenantBySlug } from '@/lib/tenants';

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

async function main() {
  const raw = arg('--phone');
  if (!raw) throw new Error('--phone requerido');
  const phone = normalizeAr(raw);

  const tenant = await getTenantBySlug('king');
  if (!tenant) throw new Error('tenant king no encontrado');

  const rows = await db
    .select({ id: chatSessions.id, sessionKey: chatSessions.sessionKey, step: chatSessions.step, name: chatSessions.name })
    .from(chatSessions)
    .where(and(eq(chatSessions.tenantId, tenant.id), eq(chatSessions.phone, phone)));

  if (!rows.length) {
    console.log(`Sin sesión para ${phone} — al abrir el chat se crea una nueva.`);
    return;
  }

  for (const r of rows) {
    await db.delete(chatSessions).where(eq(chatSessions.id, r.id));
    console.log(`Eliminada sesión ${r.sessionKey} (${r.name ?? 'sin nombre'}, step=${r.step ?? '?'})`);
  }
  console.log(`Listo. Refrescá https://chat.fichaslibres.online/chat/king y volvé a iniciar con ${phone}.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

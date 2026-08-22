import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { tenants } from '@/db/schema';
import { invalidateTenant } from '@/lib/tenants';

// Activa el MATCH POR PROXIMIDAD TEMPORAL para cd6239742 (RED VIP): su lead llega
// por el livechat de Kommo embebido en el portal externo (Vercel) y NO transporta
// el token. Con esto, el webhook ata el lead recién creado a la última atribución
// no matcheada del tenant dentro de la ventana. Aditivo: solo afecta a este tenant.
const WINDOW_SEC = 600; // 10 min

async function main() {
  const [t] = await db.select().from(tenants).where(eq(tenants.slug, 'cd6239742'));
  if (!t) throw new Error('no tenant cd6239742');

  const cf = { ...((t.customFields ?? {}) as Record<string, number>), proximity_match_sec: WINDOW_SEC };
  await db.update(tenants).set({ customFields: cf, updatedAt: new Date() }).where(eq(tenants.id, t.id));
  invalidateTenant('cd6239742');

  console.log('cd6239742 → proximity_match_sec:', WINDOW_SEC);
  console.log('customFields:', JSON.stringify(cf));
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});

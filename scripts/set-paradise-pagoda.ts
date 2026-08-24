// Configura Pagoda para paradise. El token se pasa por env var PAGODA_KEY para
// NO dejarlo hardcodeado en el repo:
//   PAGODA_KEY=pgk_... npx tsx scripts/set-paradise-pagoda.ts
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { tenants } from '@/db/schema';
import { encrypt } from '@/lib/crypto';
import { invalidateTenant } from '@/lib/tenants';

async function main() {
  const key = process.env.PAGODA_KEY;
  if (!key) throw new Error('Falta env PAGODA_KEY');
  const [t] = await db.select().from(tenants).where(eq(tenants.slug, 'paradise'));
  if (!t) throw new Error('no tenant paradise');

  await db
    .update(tenants)
    .set({
      pagodaUrl: 'https://pagoda.dat4win.com',
      pagodaApiKey: encrypt(key),
      updatedAt: new Date(),
    })
    .where(eq(tenants.id, t.id));
  invalidateTenant('paradise');
  console.log('✓ Pagoda configurada para paradise (url + key cifrada). provider actual:', t.provider);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

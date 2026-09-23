import { and, eq } from 'drizzle-orm';
import { db } from '../db';
import { landings } from '../db/schema';
import { getTenantBySlug, invalidateTenant } from '../lib/tenants';

// Spam Cliente A3 (bblack): preview "10.000 en giros libres" con el avatar de
// KingPlay, y el clic termina en kplobby.com.
const SLUG = 'bblack';
const LANDING = 'spam';

async function main() {
  const t = await getTenantBySlug(SLUG);
  if (!t) throw new Error('no tenant bblack');

  const config = {
    portalUrl: 'https://kplobby.com',
    brandName: 'KingPlay',
    logoUrl: '/api/chat/kingplay/avatar',
    previewTitle: '10.000 en giros libres',
    previewDescription: 'Reclamá tus 10.000 giros libres',
    headline: 'Un segundo…',
    subtext: 'Te llevamos a tu promo',
    message: 'Hola, quiero mis 10.000 giros libres',
    pixelId: t.metaPixelId ?? '',
    ccpp: '',
    campaign: '',
    noCode: false,
    redirectDelayMs: 1200,
    waNumber: '',
  };

  const [lp] = await db
    .select({ id: landings.id })
    .from(landings)
    .where(and(eq(landings.tenantId, t.id), eq(landings.landingSlug, LANDING)))
    .limit(1);
  if (lp) {
    await db.update(landings).set({ name: 'Spam KingPlay', type: 'spam', active: true, config, updatedAt: new Date() }).where(eq(landings.id, lp.id));
  } else {
    await db.insert(landings).values({
      tenantId: t.id,
      landingSlug: LANDING,
      name: 'Spam KingPlay',
      type: 'spam',
      active: true,
      config,
    });
  }
  invalidateTenant(SLUG);
  console.log('https://go.fichaslibres.online/l/bblack/spam');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });

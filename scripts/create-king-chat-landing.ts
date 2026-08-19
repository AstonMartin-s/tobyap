import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { landings } from '@/db/schema';
import { getTenantBySlug } from '@/lib/tenants';

// Crea (o actualiza) una landing PUBLI para king que redirige al CHAT web.
async function main() {
  const t = await getTenantBySlug('king');
  if (!t) throw new Error('no tenant');
  const landingSlug = 'go';
  const config = {
    chatSlug: 'king', // ← redirige a /chat/king en vez de wa.me
    pixelId: t.metaPixelId ?? '',
    brandName: 'King',
    primaryColor: '#25d366',
    ccpp: 'A2', // Bono20% por defecto (se puede overridear por URL)
    campaign: '', // la campaña la pasa el link del anuncio (?campaign=...)
    headline: 'Un segundo…',
    subtext: 'Te estamos conectando con King 🎰',
    redirectDelayMs: 1200,
    waNumber: '',
  } as Record<string, string | number | null>;

  const [existing] = await db.select().from(landings).where(and(eq(landings.tenantId, t.id), eq(landings.landingSlug, landingSlug)));
  if (existing) {
    await db.update(landings).set({ type: 'publi', active: true, config }).where(eq(landings.id, existing.id));
    console.log('actualizada landing', landingSlug);
  } else {
    await db.insert(landings).values({ tenantId: t.id, landingSlug, name: 'Publi Chat', type: 'publi', active: true, config });
    console.log('creada landing', landingSlug);
  }
  console.log('URL publi: https://tobyap-production.up.railway.app/l/king/go?ccpp=A2&campaign=C4');
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

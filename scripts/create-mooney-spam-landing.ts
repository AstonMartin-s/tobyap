import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { landings } from '@/db/schema';
import { getTenantBySlug } from '@/lib/tenants';

// Landing tipo "spam" (categoría interna) para mooney: redirige SIEMPRE al número
// fijo 1151368239 (fuera de este CRM, no mapeado en Kommo), con mensaje fijo.
// La URL/branding NO debe mencionar "spam" ni "mooney".
async function main() {
  const t = await getTenantBySlug('mooneyatkinson');
  if (!t) throw new Error('no tenant');
  const oldSlug = 'spam1';
  const landingSlug = 'regalo1';
  const alias = 'primario1'; // URL corta: /l/primario1 (no expone el tenant)
  const config = {
    // Formato internacional AR completo (54 + 9 + área + número). El número
    // local solo (sin 54 9) hace que WhatsApp diga "número no válido".
    waNumber: '5491151368239',
    useFixedNumber: true, // ignora la rotación de números activos de la categoría "spam"
    noCode: true, // sin webhook en ese CRM: no matchea el token, no lo mandamos. Igual contamos clics/redirects.
    message: 'Hola vengo del link y quiero mi bonificacion',
    pixelId: t.metaPixelId ?? '',
    brandName: 'Regalo',
    primaryColor: '#8B5CF6', // violeta
    headline: '¡Listo para tu regalo!',
    subtext: 'Te redirigimos a WhatsApp en un instante.',
    ccpp: '',
    campaign: '',
    redirectDelayMs: 1200,
  } as Record<string, string | number | boolean | null>;

  // Borramos la landing vieja con el slug "spam1" (ya no se usa).
  const [old] = await db.select().from(landings).where(and(eq(landings.tenantId, t.id), eq(landings.landingSlug, oldSlug)));
  if (old) {
    await db.delete(landings).where(eq(landings.id, old.id));
    console.log('borrada landing vieja', oldSlug);
  }

  const [existing] = await db.select().from(landings).where(and(eq(landings.tenantId, t.id), eq(landings.landingSlug, landingSlug)));
  if (existing) {
    await db.update(landings).set({ type: 'spam', active: true, config, alias }).where(eq(landings.id, existing.id));
    console.log('actualizada landing', landingSlug, 'alias:', alias);
  } else {
    await db.insert(landings).values({ tenantId: t.id, landingSlug, name: 'Regalo (spam) 1151368239', type: 'spam', active: true, config, alias });
    console.log('creada landing', landingSlug, 'alias:', alias);
  }
  console.log('URL corta: https://go.fichaslibres.online/l/primario1');
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

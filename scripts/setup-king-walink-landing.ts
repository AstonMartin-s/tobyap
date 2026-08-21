import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { clientSettings, landings } from '@/db/schema';
import { getTenantBySlug } from '@/lib/tenants';

// Landing walink de king: soporte sin código promocional.
// URL: /l/king/walink?campaign=Soporte
async function main() {
  const slug = 'king';
  const t = await getTenantBySlug(slug);
  if (!t) throw new Error('no tenant king');

  const landingSlug = 'walink';
  const supportLandingUrl = `https://go.fichaslibres.online/l/${slug}/walink?campaign=Soporte`;

  const [existing] = await db
    .select()
    .from(landings)
    .where(and(eq(landings.tenantId, t.id), eq(landings.landingSlug, landingSlug)));

  const supportMessage = 'Hola! vengo del chat y quiero mi promo 🎰';
  const prev = (existing?.config ?? {}) as Record<string, string | number | boolean | null>;
  const config: Record<string, string | number | boolean | null> = {
    ...prev,
    noCode: true,
    useFixedNumber: false,
    waNumber: '',
    ccpp: '',
    campaign: 'Soporte',
    message: supportMessage,
    headline: String(prev.headline || 'Te redirigimos a soporte…'),
    subtext: String(prev.subtext || 'WhatsApp · atención 24hs'),
    redirectDelayMs: prev.redirectDelayMs ?? 1200,
    pixelId: String(prev.pixelId ?? t.metaPixelId ?? ''),
    brandName: String(prev.brandName ?? 'KingPlay Soporte'),
    primaryColor: String(prev.primaryColor ?? '#008069'),
  };

  if (existing) {
    await db.update(landings).set({ type: 'soporte', active: true, config }).where(eq(landings.id, existing.id));
    console.log('actualizada landing', landingSlug);
  } else {
    await db.insert(landings).values({
      tenantId: t.id,
      landingSlug,
      name: 'Soporte WhatsApp (walink)',
      type: 'soporte',
      active: true,
      config,
    });
    console.log('creada landing', landingSlug);
  }

  const [row] = await db.select().from(clientSettings).where(eq(clientSettings.tenantId, t.id)).limit(1);
  const chatConfig = (row?.chatConfig ?? {}) as Record<string, unknown>;
  const links = { ...(chatConfig.links as Record<string, string> | undefined) };
  links.support = supportLandingUrl;
  const next = { ...chatConfig, links, postAccreditCajera: true };
  await db
    .insert(clientSettings)
    .values({ tenantId: t.id, chatConfig: next })
    .onConflictDoUpdate({
      target: clientSettings.tenantId,
      set: { chatConfig: next, updatedAt: new Date() },
    });

  console.log('chatConfig.links.support →', supportLandingUrl);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

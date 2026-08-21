import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { clientSettings, landings } from '@/db/schema';
import { getTenantBySlug } from '@/lib/tenants';

// Landing walink de bblack: redirige a WhatsApp de soporte SIN código promocional
// (líneas fuera del CRM — no matchean token). URL: /l/bblack/walink?campaign=Soporte
async function main() {
  const t = await getTenantBySlug('bblack');
  if (!t) throw new Error('no tenant bblack');

  const landingSlug = 'walink';
  const supportLandingUrl = 'https://go.fichaslibres.online/l/bblack/walink?campaign=Soporte';

  const [existing] = await db
    .select()
    .from(landings)
    .where(and(eq(landings.tenantId, t.id), eq(landings.landingSlug, landingSlug)));

  const supportMessage = 'Hola! vengo del chat y quiero mi promo 🎰';
  const prev = (existing?.config ?? {}) as Record<string, string | number | boolean | null>;
  const config: Record<string, string | number | boolean | null> = {
    ...prev,
    noCode: true,
    useFixedNumber: prev.useFixedNumber ?? true,
    ccpp: '',
    campaign: 'Soporte',
    message: supportMessage,
    headline: String(prev.headline || 'Te redirigimos a soporte…'),
    subtext: String(prev.subtext || 'WhatsApp · atención 24hs'),
    redirectDelayMs: prev.redirectDelayMs ?? 1200,
    pixelId: String(prev.pixelId ?? t.metaPixelId ?? ''),
    brandName: String(prev.brandName ?? 'BlackBet Soporte'),
    primaryColor: String(prev.primaryColor ?? '#c9a227'),
  };

  if (existing) {
    await db.update(landings).set({ type: 'soporte', active: true, config }).where(eq(landings.id, existing.id));
    console.log('actualizada landing', landingSlug, 'noCode=true');
  } else {
    await db.insert(landings).values({
      tenantId: t.id,
      landingSlug,
      name: 'Soporte WhatsApp (walink)',
      type: 'soporte',
      active: true,
      config,
    });
    console.log('creada landing', landingSlug, 'noCode=true');
  }

  // Link de soporte del chat → esta landing (sin ccpp).
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
  console.log('URL:', supportLandingUrl);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

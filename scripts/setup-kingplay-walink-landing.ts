import { and, eq } from 'drizzle-orm';
import { db } from '../db';
import { clientSettings, landings } from '../db/schema';
import { getTenantBySlug } from '../lib/tenants';
import { parseSupportDest, walinkSupportUrl } from '../lib/chat/runtime';

// Landing walink de KingCBA (kingplay). Sin números en el pool: el hop usa
// redirectUrl (wa.link) o Config → walink / teléfono. No inventamos destino.
async function main() {
  const slug = 'kingplay';
  const t = await getTenantBySlug(slug);
  if (!t) throw new Error('no tenant kingplay');

  const supportLandingUrl = walinkSupportUrl(slug);
  const [settings] = await db.select().from(clientSettings).where(eq(clientSettings.tenantId, t.id)).limit(1);
  const dest = parseSupportDest(settings?.walink);

  const [existing] = await db
    .select()
    .from(landings)
    .where(and(eq(landings.tenantId, t.id), eq(landings.landingSlug, 'walink')));

  const prev = (existing?.config ?? {}) as Record<string, string | number | boolean | null>;
  const config: Record<string, string | number | boolean | null> = {
    ...prev,
    noCode: true,
    useFixedNumber: false,
    waNumber: dest.waNumber ?? (typeof prev.waNumber === 'string' ? prev.waNumber : ''),
    ccpp: '',
    redirectUrl: dest.redirectUrl ?? (typeof prev.redirectUrl === 'string' ? prev.redirectUrl : ''),
    campaign: 'Soporte',
    message: 'Hola! vengo del chat y quiero atencion con un agente',
    headline: String(prev.headline || 'Te redirigimos a soporte…'),
    subtext: String(prev.subtext || 'WhatsApp · atención 24hs'),
    redirectDelayMs: prev.redirectDelayMs ?? 1200,
    pixelId: String(prev.pixelId ?? t.metaPixelId ?? ''),
    brandName: String(prev.brandName ?? 'KingCba Soporte'),
    primaryColor: String(prev.primaryColor ?? '#008069'),
  };

  if (existing) {
    await db.update(landings).set({ type: 'soporte', active: true, config }).where(eq(landings.id, existing.id));
    console.log('actualizada landing walink');
  } else {
    await db.insert(landings).values({
      tenantId: t.id,
      landingSlug: 'walink',
      name: 'Soporte WhatsApp (walink)',
      type: 'soporte',
      active: true,
      config,
    });
    console.log('creada landing walink');
  }

  const chatConfig = (settings?.chatConfig ?? {}) as Record<string, unknown>;
  const links = { ...((chatConfig.links as Record<string, string> | undefined) ?? {}) };
  links.support = supportLandingUrl;
  const next = { ...chatConfig, links, supportUrl: supportLandingUrl };
  await db
    .insert(clientSettings)
    .values({ tenantId: t.id, chatConfig: next })
    .onConflictDoUpdate({
      target: clientSettings.tenantId,
      set: { chatConfig: next, updatedAt: new Date() },
    });

  console.log('links.support →', supportLandingUrl);
  console.log('dest', dest.redirectUrl || dest.waNumber || '(vacío — cargar Config walink o un número soporte/cajero)');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

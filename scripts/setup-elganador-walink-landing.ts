import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { clientSettings, landings } from '@/db/schema';
import { getTenantBySlug, invalidateTenant } from '@/lib/tenants';

// Fix soporte elganador: el chat/panel derivan soporte, cargar y retirar a
// /l/elganador/walink?campaign=Soporte (convención walinkSupportUrl), pero esa
// landing NO existía (sólo había una llamada "soporte"). Resultado: el cliente
// veía "Landing no disponible" y nunca llegaba a WhatsApp.
// Fix: crear la landing `walink` (type=soporte, rotación del número soporte
// activo) espejando la config de la landing `soporte` ya funcional, y reafirmar
// los links del chat. Dejamos `soporte` activa también (ya funciona) por si hay
// material impreso/afiliados usando esa URL.
async function main() {
  const slug = 'elganador';
  const t = await getTenantBySlug(slug);
  if (!t) throw new Error('no tenant elganador');

  const landingSlug = 'walink';
  const supportLandingUrl = `https://go.fichaslibres.online/l/${slug}/walink?campaign=Soporte`;

  // Espejamos la config de la landing `soporte` (rotación del número soporte).
  const [sopLanding] = await db
    .select()
    .from(landings)
    .where(and(eq(landings.tenantId, t.id), eq(landings.landingSlug, 'soporte')));
  const sopCfg = (sopLanding?.config ?? {}) as Record<string, string | number | boolean | null>;

  const [existing] = await db
    .select()
    .from(landings)
    .where(and(eq(landings.tenantId, t.id), eq(landings.landingSlug, landingSlug)));

  const prev = (existing?.config ?? {}) as Record<string, string | number | boolean | null>;
  const config: Record<string, string | number | boolean | null> = {
    ...sopCfg,
    ...prev,
    noCode: true,
    useFixedNumber: false,
    waNumber: '', // vacío → rotación entre números 'soporte' activos
    chatSlug: '',
    ccpp: '',
    campaign: 'Soporte',
    message: String(sopCfg.message || 'Hola! Vengo del chat, quiero completar una operacion'),
    headline: String(prev.headline || 'Te redirigimos a soporte…'),
    subtext: String(prev.subtext || 'WhatsApp · atención 24hs'),
    redirectDelayMs: Number(prev.redirectDelayMs ?? 1200),
    pixelId: String(prev.pixelId ?? t.metaPixelId ?? ''),
    brandName: String(sopCfg.brandName || 'El Ganador'),
    primaryColor: String(sopCfg.primaryColor || '#7F00FF'),
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

  // Reafirmar links del chat → walink (soporte, cargar, retirar).
  const [row] = await db.select().from(clientSettings).where(eq(clientSettings.tenantId, t.id)).limit(1);
  const chatConfig = (row?.chatConfig ?? {}) as Record<string, unknown>;
  const links = { ...(chatConfig.links as Record<string, string> | undefined) };
  links.support = supportLandingUrl;
  links.portal_deposit = supportLandingUrl;
  links.portal_withdraw = supportLandingUrl;
  const next = { ...chatConfig, links, supportUrl: supportLandingUrl, landingDomain: '' };
  await db
    .insert(clientSettings)
    .values({ tenantId: t.id, chatConfig: next })
    .onConflictDoUpdate({
      target: clientSettings.tenantId,
      set: { chatConfig: next, updatedAt: new Date() },
    });
  invalidateTenant(slug);

  console.log('chatConfig.links.support/portal_deposit/portal_withdraw →', supportLandingUrl);
  console.log('✓ elganador soporte (walink) alineado');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });

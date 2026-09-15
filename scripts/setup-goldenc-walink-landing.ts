import { and, eq } from 'drizzle-orm';
import { db } from '../db';
import { clientSettings, landings } from '../db/schema';
import { getTenantBySlug, invalidateTenant } from '../lib/tenants';
import { parseSupportDest, walinkSupportUrl } from '../lib/chat/runtime';

// GoldenC: el botón "Ir a WhatsApp" del header usa /l/goldenc/walink por default
// (waBtnUrl vacío). Esa landing no existía → "Landing no disponible".
// Destino real (Config walink / Ajustes support): wa.me/message/...
// Creamos el hop walink y apuntamos el botón del header al mismo destino.
async function main() {
  const slug = 'goldenc';
  const t = await getTenantBySlug(slug);
  if (!t) throw new Error('no tenant goldenc');

  const [settings] = await db.select().from(clientSettings).where(eq(clientSettings.tenantId, t.id)).limit(1);
  const dest = parseSupportDest(settings?.walink);
  if (!dest.redirectUrl && !dest.waNumber) {
    throw new Error('goldenc no tiene walink/support cargado en Config');
  }

  const hop = walinkSupportUrl(slug);
  const destUrl = dest.redirectUrl || hop;

  const [existing] = await db
    .select()
    .from(landings)
    .where(and(eq(landings.tenantId, t.id), eq(landings.landingSlug, 'walink')));

  const prev = (existing?.config ?? {}) as Record<string, string | number | boolean | null>;
  const config: Record<string, string | number | boolean | null> = {
    ...prev,
    noCode: true,
    useFixedNumber: false,
    waNumber: dest.waNumber ?? '',
    chatSlug: '',
    ccpp: '',
    redirectUrl: dest.redirectUrl ?? (typeof prev.redirectUrl === 'string' ? prev.redirectUrl : ''),
    campaign: 'Soporte',
    message: 'Hola! Vengo del chat, quiero hablar con un agente',
    headline: String(prev.headline || 'Te redirigimos a soporte…'),
    subtext: String(prev.subtext || 'WhatsApp · atención 24hs'),
    redirectDelayMs: Number(prev.redirectDelayMs ?? 1200),
    pixelId: String(prev.pixelId ?? t.metaPixelId ?? ''),
    brandName: String(prev.brandName || t.name),
    primaryColor: String(prev.primaryColor || '#25D366'),
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
  // Solo el slot de soporte. Portal (ganamosbet) no se toca.
  links.support = destUrl;
  const next = {
    ...chatConfig,
    waBtnEnabled: true,
    waBtnUrl: destUrl,
    supportUrl: destUrl,
    links,
  };
  await db
    .insert(clientSettings)
    .values({ tenantId: t.id, chatConfig: next })
    .onConflictDoUpdate({
      target: clientSettings.tenantId,
      set: { chatConfig: next, updatedAt: new Date() },
    });
  invalidateTenant(slug);

  console.log('settings.walink', settings?.walink);
  console.log('settings.message WA?', String(settings?.message ?? '').match(/wa\.me|wa\.link|whatsapp/i)?.[0] || 'no');
  console.log('settings.regularMessage WA?', String(settings?.regularMessage ?? '').match(/wa\.me|wa\.link|whatsapp/i)?.[0] || 'no');
  console.log('waBtnUrl / supportUrl / links.support →', destUrl);
  console.log('hop (fallback)', hop);
  console.log('portal_deposit', links.portal_deposit);
  console.log('✓ goldenc WhatsApp alineado');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

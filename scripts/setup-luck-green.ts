import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { clientSettings } from '@/db/schema';
import { getTenantBySlug, invalidateTenant } from '@/lib/tenants';

// Alinea Luck al esquema GoldenC: Green API (greenvip.net) crea el usuario.
// No pisa token / source_id / CBU. Idempotente.
const SLUG = 'luck';
const PORTAL = 'https://greenvip.net';
const SUPPORT = `https://go.fichaslibres.online/l/${SLUG}/walink?campaign=Soporte`;

async function main() {
  const t = await getTenantBySlug(SLUG);
  if (!t) throw new Error('no tenant luck');
  if (t.provider !== 'king' || !t.partnerApiKey || !t.customFields.king_source_id) {
    throw new Error(`luck no está listo para Green: provider=${t.provider} key=${!!t.partnerApiKey} source=${t.customFields.king_source_id}`);
  }

  const [row] = await db.select().from(clientSettings).where(eq(clientSettings.tenantId, t.id));
  const prev = (row?.chatConfig ?? {}) as Record<string, unknown>;
  const prevTpl = (prev.templates && typeof prev.templates === 'object' && !Array.isArray(prev.templates)
    ? (prev.templates as Record<string, string>)
    : {});
  const { welcome_body: _drop, ...keepTpl } = prevTpl;

  const next = {
    ...prev,
    brandName: 'Luck',
    portalUrl: PORTAL,
    waBtnEnabled: true,
    waBtnUrl: SUPPORT,
    supportUrl: SUPPORT,
    landingDomain: '',
    magicLinks: ['portal_play', 'portal_forgot', 'portal_deposit', 'portal_withdraw'],
    postAccreditCajera: false,
    links: {
      support: SUPPORT,
      portal_play: PORTAL,
      portal_login: PORTAL,
      portal_forgot: PORTAL,
      portal_deposit: PORTAL,
      portal_withdraw: PORTAL,
    },
    templates: {
      ...keepTpl,
      welcome_body:
        'Un gusto atenderte 🎰\n' +
        'Bienvenido a *{brand}*.\n\n' +
        '🎁 *Primeras 3 cargas* con *30% extra*.\n' +
        '💰 Mínimo de carga: *$5.000*\n\n' +
        'Tocá *Quiero mi cuenta* y te la creo al toque 👇',
    },
  };

  await db
    .insert(clientSettings)
    .values({ tenantId: t.id, chatConfig: next })
    .onConflictDoUpdate({
      target: clientSettings.tenantId,
      set: { chatConfig: next, updatedAt: new Date() },
    });
  invalidateTenant(SLUG);

  console.log('luck Green alineado a GoldenC');
  console.log({
    provider: t.provider,
    portal: t.partnerApiUrl,
    source: t.customFields.king_source_id,
    fichas: t.features.fichas,
    pagoda: !!t.pagodaApiKey,
    links: next.links,
  });
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

// Alta de `luck` (Luck Casino Virtual) — plataforma Ganamosonline, SIN Kommo.
// Provider `manual`: el operador crea el usuario real a mano. El chat da DEMO +
// botón CBU (misma mecánica que ElGanador). Pixel + CAPI token COPIADOS de
// Marceneitor (king).
//
// Uso:
//   npx tsx --env-file=.env scripts/onboard-luck.ts
// Idempotente (upsert por slug). Re-correr NO pisa el avatar si el JPG no está.
import { readFileSync, existsSync } from 'node:fs';
import { upsertTenant, getTenantBySlug } from '@/lib/tenants';

const BRAND = 'Luck';
const SLUG = 'luck';
const SUFFIX = 'A11';
const PLAYER_PORTAL = 'https://ganamosonline.com';
const SUPPORT_WA = '5493513717264';
const CHAT_COLOR = '#008069'; // verde WhatsApp (pedido: el chat imita a WhatsApp)
const LANDING_COLOR = '#166534'; // verde de marca (logo)
const SUPPORT_LANDING = `https://go.fichaslibres.online/l/${SLUG}/walink?campaign=Soporte`;
const AVATAR_JPG = '.tmp-avatar/luck-256.jpg';
const PANEL_USER = 'Luck';
const PANEL_PASS = 'Luck2026';

async function main() {
  const king = await getTenantBySlug('king');
  if (!king) throw new Error('no encuentro el tenant king (Marceneitor) para copiar pixel/token');
  if (!king.metaPixelId || !king.metaCapiToken) throw new Error('king sin pixel/token para copiar');

  let avatarUrl: string | undefined;
  if (existsSync(AVATAR_JPG)) {
    const b64 = readFileSync(AVATAR_JPG).toString('base64');
    avatarUrl = `data:image/jpeg;base64,${b64}`;
    console.log('avatar data URL bytes:', avatarUrl.length);
  } else {
    console.warn('sin', AVATAR_JPG, '— se omite avatar (correr con el JPG y re-ejecutar)');
  }

  await upsertTenant({
    slug: SLUG,
    name: BRAND,
    niche: 'circo',
    role: 'client',
    platform: 'meta',
    metaPixelId: king.metaPixelId,
    metaCapiToken: king.metaCapiToken,
    eventSuffix: SUFFIX,
    readonly: true,
    provider: 'manual',
    customFields: {
      feat_embudo: 1,
      feat_fichas: 0,
      feat_livechat: 1,
    },
    panelUser: PANEL_USER,
    panelPassword: PANEL_PASS,
    panelUsers: [
      { username: PANEL_USER, password: PANEL_PASS, displayName: BRAND, role: 'admin' },
    ],
    settings: {
      accountName: 'Laureano Fernandez',
      accountCbu: '4530000800016965499281',
    },
    numbers: [
      { name: 'Soporte', phone: SUPPORT_WA, status: true, type: 'soporte' },
    ],
    chatConfig: {
      brandName: BRAND,
      offerType: 'bonus',
      offerValue: 30,
      minDeposit: 5000,
      primaryColor: CHAT_COLOR,
      ...(avatarUrl ? { avatarUrl, avatarPath: null } : {}),
      waBtnEnabled: true,
      waBtnUrl: '',
      supportUrl: SUPPORT_LANDING,
      landingDomain: '',
      magicLinks: [],
      links: {
        portal_login: PLAYER_PORTAL,
        portal_forgot: PLAYER_PORTAL,
        portal_play: PLAYER_PORTAL,
        portal_deposit: SUPPORT_LANDING,
        portal_withdraw: SUPPORT_LANDING,
        support: SUPPORT_LANDING,
      },
      templates: {
        welcome_body:
          'Un gusto atenderte 🎰\n' +
          'Bienvenido a *{brand}*.\n\n' +
          '🎁 *Primeras 3 cargas* con *30% extra*.\n' +
          '💰 Mínimo de carga: *$5.000*\n\n' +
          'Podés entrar a mirar la plataforma con este usuario de prueba:\n' +
          '👤 Usuario: *lucky*\n' +
          '🔐 Contraseña: *123lucky*\n\n' +
          `🔗 ${PLAYER_PORTAL}\n\n` +
          'Cuando quieras cargar, tocá el botón de CBU 👇',
      },
    },
    landings: [
      {
        landingSlug: 'go',
        name: 'Publi Chat',
        type: 'publi',
        config: {
          chatSlug: SLUG,
          pixelId: king.metaPixelId,
          brandName: BRAND,
          primaryColor: LANDING_COLOR,
          ccpp: SUFFIX,
          campaign: '',
          headline: 'Un segundo…',
          subtext: `Te estamos conectando con ${BRAND} 🎰`,
          redirectDelayMs: 1200,
          waNumber: '',
        },
      },
      {
        landingSlug: 'walink',
        name: 'Soporte WhatsApp (walink)',
        type: 'soporte',
        config: {
          noCode: true,
          useFixedNumber: false,
          waNumber: '',
          chatSlug: '',
          ccpp: '',
          campaign: 'Soporte',
          message: 'Hola! Vengo del chat, quiero completar una operacion',
          headline: 'Te redirigimos a soporte…',
          subtext: 'WhatsApp · atención 24hs',
          redirectDelayMs: 1200,
          pixelId: king.metaPixelId,
          brandName: BRAND,
          primaryColor: LANDING_COLOR,
        },
      },
    ],
  });

  const t = await getTenantBySlug(SLUG);
  console.log('tenant luck:', {
    id: t?.id,
    name: t?.name,
    provider: t?.provider,
    metaPixelId: t?.metaPixelId,
    tokenMatchesKing: t?.metaCapiToken === king.metaCapiToken,
    eventSuffix: t?.eventSuffix,
    readonly: t?.readonly,
    fichas: t?.features.fichas,
    livechat: t?.features.livechat,
  });
  console.log('\nPanel: https://panel.trackerapp.site/login  (user Luck / Luck2026)');
  console.log(`Publi: https://tobyap-production.up.railway.app/l/${SLUG}/go?ccpp=${SUFFIX}&campaign=C1`);
  console.log(`Alias: https://go.fichaslibres.online/l/${SLUG}/go?ccpp=${SUFFIX}&campaign=C1`);
  console.log('Soporte:', SUPPORT_LANDING);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });

// Alta de `piliking` (PiliKing) — plataforma KINGCASH (ag.kingcash7.net).
// SIN Kommo (readonly). Pixel COMPARTIDO + CAPI token COPIADO de Marceneitor
// (king/greenbet), por pedido. Fichas por provider 'kingcash' con el AGENTE TEST
// (test20256) hasta tener credenciales reales.
//
// Secretos por env (NO hardcodear — no van a git):
//   KC_LOGIN, KC_PASS  = credenciales del agente kingcash (por ahora, test)
// Uso:
//   KC_LOGIN=... KC_PASS=... npx tsx --env-file=.env scripts/onboard-piliking.ts
// Idempotente (upsert por slug).
import { upsertTenant, getTenantBySlug } from '@/lib/tenants';

const BRAND = 'PiliKing';
const SLUG = 'piliking';
const SUFFIX = 'A9';
const KC_URL = 'https://ag.kingcash7.net';
// Portal del jugador (confirmado por el cliente).
const PLAYER_PORTAL = 'https://piliking.click/';

async function main() {
  const kcLogin = process.env.KC_LOGIN;
  const kcPass = process.env.KC_PASS;
  if (!kcLogin || !kcPass) throw new Error('faltan KC_LOGIN / KC_PASS en el entorno');

  // Pixel + CAPI token copiados de Marceneitor (king / greenbet).
  const king = await getTenantBySlug('king');
  if (!king) throw new Error('no encuentro el tenant king (Marceneitor) para copiar pixel/token');
  if (!king.metaPixelId || !king.metaCapiToken) throw new Error('king sin pixel/token para copiar');

  // Colores: la LANDING va dorada (marca PiliKing), el CHAT/livechat va verde
  // WhatsApp (pedido del cliente: el chat imita a WhatsApp).
  const landingColor = '#B8860B'; // dorado marca PiliKing (logo negro/dorado)
  const chatColor = '#008069'; // verde WhatsApp (DEFAULT_HEADER)
  // Nota: el avatar (foto de perfil) se setea aparte con scripts/set-piliking-avatar.ts
  // (data URL). Re-correr este onboard NO lo re-aplica; volvé a correr aquel si hace falta.

  await upsertTenant({
    slug: SLUG,
    name: BRAND,
    niche: 'circo',
    role: 'client',
    platform: 'meta',
    // Pixel compartido + token de Marceneitor (copiados).
    metaPixelId: king.metaPixelId,
    metaCapiToken: king.metaCapiToken,
    eventSuffix: SUFFIX,
    // SIN Kommo: no escribimos en ningún CRM.
    readonly: true,
    // Fichas por Kingcash (agente TEST por ahora).
    provider: 'kingcash',
    partnerApiUrl: KC_URL,
    partnerApiKey: JSON.stringify({ login: kcLogin, password: kcPass }),
    // Login del panel TOBYAP.
    panelUser: BRAND,
    panelPassword: 'Piliking123',
    panelUsers: [
      { username: BRAND, password: 'Piliking123', displayName: BRAND, role: 'admin' },
    ],
    // Cuenta de depósito que muestra el chat.
    settings: {
      accountName: 'Pablo Damian Gomez Cuevas',
      accountCbu: '0000088800010000014446',
    },
    // Skin del chat web. Bono 200% = el bono automático del agente kingcash.
    chatConfig: {
      brandName: BRAND,
      offerType: 'bonus',
      offerValue: 200,
      minDeposit: 1000,
      primaryColor: chatColor,
      links: {
        portal_login: PLAYER_PORTAL, // ⚠️ CONFIRMAR
        portal_forgot: PLAYER_PORTAL,
        portal_play: PLAYER_PORTAL,
        portal_deposit: PLAYER_PORTAL,
        portal_withdraw: PLAYER_PORTAL,
        support: 'https://wa.me/', // ⚠️ CONFIRMAR WhatsApp de soporte
      },
      magicLinks: [], // kingcash: login estático, sin magic-link
    },
    // Landing "go" → chat (misma mecánica que bblack/king).
    landings: [
      {
        landingSlug: 'go',
        name: 'Publi Chat',
        type: 'publi',
        config: {
          chatSlug: SLUG,
          pixelId: king.metaPixelId,
          brandName: BRAND,
          primaryColor: landingColor,
          ccpp: SUFFIX,
          campaign: '',
          headline: 'Un segundo…',
          subtext: `Te estamos conectando con ${BRAND} 🎰`,
          redirectDelayMs: 1200,
          waNumber: '',
        },
      },
    ],
  });

  const t = await getTenantBySlug(SLUG);
  console.log('tenant piliking:', {
    id: t?.id,
    name: t?.name,
    provider: t?.provider,
    partnerApiUrl: t?.partnerApiUrl,
    hasKcCreds: !!t?.partnerApiKey,
    metaPixelId: t?.metaPixelId,
    tokenMatchesKing: t?.metaCapiToken === king.metaCapiToken,
    eventSuffix: t?.eventSuffix,
    readonly: t?.readonly,
    features: t?.features,
  });
  console.log('\nPanel: https://panel.trackerapp.site/login  (user PiliKing / Piliking123)');
  console.log('Publi (cuando confirmen portal/CBU): https://tobyap-production.up.railway.app/l/piliking/go?ccpp=A9&campaign=C1');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });

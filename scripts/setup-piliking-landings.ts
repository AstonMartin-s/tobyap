// PiliKing: cierra el alta con datos reales del cliente.
//   - portal del jugador: https://piliking.click/  (todos los links portal_*)
//   - soporte: número 1178292653 ("numero1") como wa.me directo
//   - landing SOPORTE (walink): redirige a WhatsApp con el mensaje pedido
//   - landing LIVECHAT (chat): redirige al chat web /chat/piliking
// URLs públicas: landings en go.fichaslibres.online, chat en chat.fichaslibres.online
// (CHAT_ORIGIN). NO se usa el dominio de Railway.
// Idempotente: mergea sobre lo existente.
//
// Uso:  npx tsx --env-file=.env scripts/setup-piliking-landings.ts
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { clientSettings, landings, numbers } from '@/db/schema';
import { getTenantBySlug } from '@/lib/tenants';

const SLUG = 'piliking';
const PORTAL = 'https://piliking.click/';
const WA = '5491178292653'; // 1178292653 → AR móvil (54 9 11 ...)
const WA_NAME = 'numero1';
const SUPPORT_MSG = 'Hola vengo del chat y quiero hablar con un agente.';
const LANDING_COLOR = '#B8860B'; // dorado marca PiliKing
const LANDING_HOST = 'go.fichaslibres.online';
const SUPPORT_LANDING_URL = `https://${LANDING_HOST}/l/${SLUG}/walink?campaign=Soporte`;

async function upsertLanding(tenantId: string, landingSlug: string, name: string, type: string, config: Record<string, string | number | boolean | null>) {
  const [existing] = await db
    .select({ id: landings.id })
    .from(landings)
    .where(and(eq(landings.tenantId, tenantId), eq(landings.landingSlug, landingSlug)))
    .limit(1);
  if (existing) {
    await db.update(landings).set({ name, type, active: true, config, updatedAt: new Date() }).where(eq(landings.id, existing.id));
  } else {
    await db.insert(landings).values({ tenantId, landingSlug, name, type, active: true, config });
  }
}

async function main() {
  const t = await getTenantBySlug(SLUG);
  if (!t) throw new Error(`no encuentro el tenant ${SLUG}`);
  const pixelId = t.metaPixelId ?? '';

  // 1) chatConfig: portal del jugador + link de soporte (landing pública).
  const [row] = await db
    .select({ chatConfig: clientSettings.chatConfig })
    .from(clientSettings)
    .where(eq(clientSettings.tenantId, t.id))
    .limit(1);
  const prev = (row?.chatConfig ?? {}) as Record<string, unknown>;
  const prevLinks = (prev.links ?? {}) as Record<string, string>;
  const links = {
    ...prevLinks,
    portal_login: PORTAL,
    portal_forgot: PORTAL,
    portal_play: PORTAL,
    portal_deposit: PORTAL,
    portal_withdraw: PORTAL,
    support: SUPPORT_LANDING_URL,
  };
  const next = { ...prev, links, landingDomain: '' }; // landingDomain vacío = go.fichaslibres.online
  await db
    .insert(clientSettings)
    .values({ tenantId: t.id, chatConfig: next })
    .onConflictDoUpdate({ target: clientSettings.tenantId, set: { chatConfig: next, updatedAt: new Date() } });
  console.log('chatConfig: portal →', PORTAL, '· support →', SUPPORT_LANDING_URL);

  // 2) numbers: "numero1" como soporte (idempotente por phone).
  const [existingNum] = await db
    .select({ id: numbers.id })
    .from(numbers)
    .where(and(eq(numbers.tenantId, t.id), eq(numbers.phone, WA)))
    .limit(1);
  if (existingNum) {
    await db.update(numbers).set({ name: WA_NAME, type: 'soporte', status: true }).where(eq(numbers.id, existingNum.id));
  } else {
    await db.insert(numbers).values({ tenantId: t.id, name: WA_NAME, phone: WA, type: 'soporte', status: true });
  }
  console.log('numbers:', WA_NAME, WA, '(soporte)');

  // 3) landing SOPORTE (walink) → WhatsApp con el mensaje pedido, tal cual.
  const waUrl = `https://wa.me/${WA}?text=${encodeURIComponent(SUPPORT_MSG)}`;
  await upsertLanding(t.id, 'walink', 'PiliKing Soporte', 'soporte', {
    brandName: 'PiliKing',
    redirectUrl: waUrl,
    primaryColor: LANDING_COLOR,
    pixelId,
    noCode: true,
    headline: 'Un segundo…',
    subtext: 'Te conectamos con un agente 🎰',
    redirectDelayMs: 1000,
  });
  console.log('landing soporte:', SUPPORT_LANDING_URL, '→', waUrl);

  // 4) landing LIVECHAT (chat) → chat web /chat/piliking (chat.fichaslibres.online).
  await upsertLanding(t.id, 'chat', 'PiliKing Chat', 'publi', {
    chatSlug: SLUG,
    pixelId,
    brandName: 'PiliKing',
    primaryColor: LANDING_COLOR,
    ccpp: 'A9',
    campaign: '',
    headline: 'Un segundo…',
    subtext: 'Te estamos conectando con PiliKing 🎰',
    redirectDelayMs: 1200,
    waNumber: '',
  });
  console.log('landing livechat:', `https://${LANDING_HOST}/l/${SLUG}/chat`);

  console.log('\nListo. URLs públicas:');
  console.log('  Soporte : ' + SUPPORT_LANDING_URL);
  console.log('  Livechat: ' + `https://${LANDING_HOST}/l/${SLUG}/chat`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });

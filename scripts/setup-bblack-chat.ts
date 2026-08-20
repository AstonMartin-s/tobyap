import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { landings, clientSettings } from '@/db/schema';
import { getTenantBySlug } from '@/lib/tenants';

// Deja lista la landing + skin del chat web para bblack (mismo patrón que
// create-king-chat-landing.ts). NO toca las landings existentes (entrada, influ1)
// que siguen redirigiendo a WhatsApp — esta es una landing NUEVA ("go") que
// redirige al chat.
async function main() {
  const t = await getTenantBySlug('bblack');
  if (!t) throw new Error('no tenant bblack');

  // 1) Landing "go" → chat (mismo bono A5/50% que ya usan en sus landings de WhatsApp).
  const landingSlug = 'go';
  const config = {
    chatSlug: 'bblack',
    pixelId: t.metaPixelId ?? '',
    brandName: 'BlackBet',
    primaryColor: '#c9a227', // dorado, distinto del verde de King
    ccpp: 'A5', // Bono50% — el mismo que ya usan hoy
    campaign: '',
    headline: 'Un segundo…',
    subtext: 'Te estamos conectando con BlackBet 🎰',
    redirectDelayMs: 1200,
    waNumber: '',
  } as Record<string, string | number | null>;

  const [existing] = await db.select().from(landings).where(and(eq(landings.tenantId, t.id), eq(landings.landingSlug, landingSlug)));
  if (existing) {
    await db.update(landings).set({ type: 'publi', active: true, config }).where(eq(landings.id, existing.id));
    console.log('actualizada landing', landingSlug);
  } else {
    await db.insert(landings).values({ tenantId: t.id, landingSlug, name: 'Publi Chat', type: 'publi', active: true, config });
    console.log('creada landing', landingSlug);
  }

  // 2) Skin del chat (client_settings.chat_config) — PLACEHOLDER en portal_login
  // y support: no tengo el dominio de jugador ni el WhatsApp de soporte de bblack
  // confirmados (el panel admin.kingplay.club es el backoffice de agente, no la
  // URL de login del jugador). Marcar para confirmar antes de ir a producción real.
  const chatConfig = {
    brandName: 'BlackBet',
    offerType: 'bonus',
    offerValue: 50,
    minDeposit: 1000,
    primaryColor: '#c9a227',
    links: {
      portal_login: 'https://kingplay.club', // ⚠️ CONFIRMAR: dominio real del jugador (puede rotar)
      portal_forgot: 'https://kingplay.club',
      portal_play: 'https://kingplay.club',
      portal_deposit: 'https://kingplay.club',
      portal_withdraw: 'https://kingplay.club',
      support: 'https://wa.me/', // ⚠️ CONFIRMAR: WhatsApp de soporte de bblack
    },
    magicLinks: [], // Partner API: sin magic-link hoy (login estático); SSO queda para fase siguiente
  };

  await db
    .insert(clientSettings)
    .values({ tenantId: t.id, chatConfig })
    .onConflictDoUpdate({ target: clientSettings.tenantId, set: { chatConfig, updatedAt: new Date() } });

  console.log('chatConfig seteado (con placeholders a confirmar):', JSON.stringify(chatConfig, null, 2));
  console.log('\nURL publi: https://tobyap-production.up.railway.app/l/bblack/go?ccpp=A5&campaign=C1');
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

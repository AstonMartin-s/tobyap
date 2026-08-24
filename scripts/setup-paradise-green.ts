import { db } from '@/db';
import { tenants, clientSettings, landings } from '@/db/schema';
import { and, eq } from 'drizzle-orm';
import { encrypt } from '@/lib/crypto';
import { invalidateTenant } from '@/lib/tenants';

// Uso:
//   PARADISE_GREEN_TOKEN=xxxx npx tsx scripts/setup-paradise-green.ts
//
// Configura paradise para operar igual que King: Pagoda para crear la cuenta +
// Green API (greenbet.uno) para fichas. Datos concretos que dio el cliente:
//   - source_id Green: 78784
//   - cuenta (titular): VANTUM
//   - CBU: 0000151500037381717133
//   - walink soporte: https://wa.link/greenplay
//
// NOTA: brandName / portalUrl / color / oferta se dejan como los de King
// (placeholders razonables) hasta que el cliente confirme los definitivos.

const SLUG = 'paradise';
const GREEN_BASE = 'https://greenbet.uno';
const GREEN_SOURCE_ID = 78784;
const ACCOUNT_NAME = 'VANTUM';
const ACCOUNT_CBU = '0000151500037381717133';
const WALINK = 'https://wa.link/greenplay';
const SUPPORT_URL = `https://go.fichaslibres.online/l/${SLUG}/walink?campaign=Soporte`;

async function main() {
  const token = process.env.PARADISE_GREEN_TOKEN;
  if (!token) throw new Error('Falta PARADISE_GREEN_TOKEN en el entorno');

  const [t] = await db.select().from(tenants).where(eq(tenants.slug, SLUG));
  if (!t) throw new Error(`tenant ${SLUG} no existe`);

  // 1) Green fichas: provider king + base + token + source_id (merge customFields)
  const cf = { ...(t.customFields as Record<string, number>), king_source_id: GREEN_SOURCE_ID };
  await db
    .update(tenants)
    .set({
      provider: 'king',
      partnerApiUrl: GREEN_BASE,
      partnerApiKey: encrypt(token),
      customFields: cf,
      updatedAt: new Date(),
    })
    .where(eq(tenants.id, t.id));

  // 2) clientSettings: cuenta VANTUM / CBU + chatConfig (espejo de King)
  const chatConfig = {
    links: {
      support: SUPPORT_URL,
      portal_play: `${GREEN_BASE}/login`,
      portal_login: `${GREEN_BASE}/login`,
      portal_forgot: `${GREEN_BASE}/login`,
      portal_deposit: `${GREEN_BASE}/login`,
      portal_withdraw: `${GREEN_BASE}/login`,
    },
    avatarUrl: `/api/chat/${SLUG}/avatar`,
    brandName: 'Paradise', // TODO confirmar nombre visible definitivo
    offerType: 'bonus', // TODO confirmar oferta
    portalUrl: `${GREEN_BASE}/login`, // TODO confirmar portal del jugador
    templates: {},
    magicLinks: ['portal_play', 'portal_deposit', 'portal_withdraw'],
    minDeposit: 1000, // TODO confirmar
    offerValue: 30, // TODO confirmar
    panelQuick: {
      barPresets: ['Reenviame el comprobante completo y legible 📸'],
      barPlaceholder: 'Mensaje libre al cliente…',
    },
    supportUrl: SUPPORT_URL,
    primaryColor: '#008069', // TODO confirmar color de marca
    landingDomain: '',
    postAccreditCajera: false,
  };

  const [cs] = await db.select().from(clientSettings).where(eq(clientSettings.tenantId, t.id));
  if (cs) {
    await db
      .update(clientSettings)
      .set({ accountName: ACCOUNT_NAME, accountCbu: ACCOUNT_CBU, chatConfig, updatedAt: new Date() })
      .where(eq(clientSettings.id, cs.id));
  } else {
    await db.insert(clientSettings).values({
      tenantId: t.id,
      accountName: ACCOUNT_NAME,
      accountCbu: ACCOUNT_CBU,
      chatConfig,
    });
  }

  // 3) landing walink de soporte → redirige TAL CUAL a wa.link/greenplay
  const walinkCfg = {
    brandName: 'Paradise Soporte',
    redirectUrl: WALINK,
    primaryColor: '#008069',
  };
  const [existing] = await db
    .select()
    .from(landings)
    .where(and(eq(landings.tenantId, t.id), eq(landings.landingSlug, 'walink')));
  if (existing) {
    await db
      .update(landings)
      .set({ type: 'soporte', active: true, config: walinkCfg })
      .where(eq(landings.id, existing.id));
  } else {
    await db.insert(landings).values({
      tenantId: t.id,
      landingSlug: 'walink',
      name: 'Paradise Soporte',
      type: 'soporte',
      active: true,
      config: walinkCfg,
    });
  }

  invalidateTenant(SLUG);
  console.log('paradise configurado: Green fichas + cuenta VANTUM + walink greenplay. Revisar TODOs de display.');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });

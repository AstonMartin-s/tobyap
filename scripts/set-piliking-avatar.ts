// Setea el avatar (foto de perfil del chat) de PiliKing como data URL y fija los
// colores: CHAT/livechat en verde WhatsApp, LANDING en dorado de marca.
// Idempotente: mergea sobre lo existente sin pisar el resto (offer, links, etc.).
//
// El avatar de prod normalmente vive en el volumen (UPLOAD_DIR=/data) vía
// avatarPath; desde local no llegamos a ese disco, así que embebemos la imagen
// como data URI en avatarUrl (el chat acepta URL externa o data URI). Es un solo
// avatar chico (~32KB), no el flujo de comprobantes, así que no infla la DB.
//
// Uso:  npx tsx --env-file=.env scripts/set-piliking-avatar.ts
import { readFileSync } from 'node:fs';
import { eq, and } from 'drizzle-orm';
import { db } from '@/db';
import { clientSettings, landings } from '@/db/schema';
import { getTenantBySlug } from '@/lib/tenants';

const SLUG = 'piliking';
const IMG = '.tmp-avatar/piliking-256.jpg';
const CHAT_COLOR = '#008069'; // verde WhatsApp (el chat imita a WhatsApp)
const LANDING_COLOR = '#B8860B'; // dorado marca PiliKing

async function main() {
  const tenant = await getTenantBySlug(SLUG);
  if (!tenant) throw new Error(`no encuentro el tenant ${SLUG}`);

  const b64 = readFileSync(IMG).toString('base64');
  const dataUrl = `data:image/jpeg;base64,${b64}`;
  console.log('data URL bytes:', dataUrl.length);

  // 1) chatConfig: avatar embebido + color del chat = verde WhatsApp.
  const [row] = await db
    .select({ chatConfig: clientSettings.chatConfig })
    .from(clientSettings)
    .where(eq(clientSettings.tenantId, tenant.id))
    .limit(1);
  const prev = (row?.chatConfig ?? {}) as Record<string, unknown>;
  const next = { ...prev, avatarUrl: dataUrl, avatarPath: null, primaryColor: CHAT_COLOR };
  await db
    .insert(clientSettings)
    .values({ tenantId: tenant.id, chatConfig: next })
    .onConflictDoUpdate({ target: clientSettings.tenantId, set: { chatConfig: next, updatedAt: new Date() } });
  console.log('chatConfig: avatar OK · primaryColor', CHAT_COLOR);

  // 2) landing "go": color dorado de marca (mergea sobre el config existente).
  const [lp] = await db
    .select({ id: landings.id, config: landings.config })
    .from(landings)
    .where(and(eq(landings.tenantId, tenant.id), eq(landings.landingSlug, 'go')))
    .limit(1);
  if (lp) {
    const lcfg = { ...(lp.config ?? {}), primaryColor: LANDING_COLOR };
    await db.update(landings).set({ config: lcfg, updatedAt: new Date() }).where(eq(landings.id, lp.id));
    console.log('landing go: primaryColor', LANDING_COLOR);
  } else {
    console.log('landing go: no encontrada (correr onboard primero)');
  }

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });

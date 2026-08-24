// Fix soporte bblack: el landingDomain quedó en "https://QuieroMiProm0" y
// walinkSupportUrl() reescribe con ese host TODAS las derivaciones a soporte
// (chat links.support, botón WA, livechat) → URL rota (HTTP 000).
// Fix: vaciar landingDomain (cae al default go.fichaslibres.online) + poner el
// link de soporte {support} en el mensaje de soporte (hoy no muestra número).
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { tenants, clientSettings } from '@/db/schema';
import { invalidateTenant } from '@/lib/tenants';

async function main() {
  const [t] = await db.select().from(tenants).where(eq(tenants.slug, 'bblack'));
  if (!t) throw new Error('no tenant bblack');
  const [s] = await db.select().from(clientSettings).where(eq(clientSettings.tenantId, t.id));
  if (!s) throw new Error('no client_settings bblack');

  const cc = { ...(s.chatConfig as Record<string, unknown>) };
  const supportUrl = 'https://go.fichaslibres.online/l/bblack/walink?campaign=Soporte';

  console.log('ANTES landingDomain:', cc.landingDomain);

  // 1) Dominio: vaciar → walinkSupportUrl cae a go.fichaslibres.online.
  cc.landingDomain = '';
  // 2) Reafirmar los links directos de soporte por las dudas.
  cc.links = { ...(cc.links as Record<string, string>), support: supportUrl };
  cc.supportUrl = supportUrl;
  cc.waBtnUrl = '';

  // 3) Mensaje de soporte: incluir el link {support} (antes no mostraba número).
  const templates = { ...((cc.templates as Record<string, string>) ?? {}) };
  templates.support =
    '🙋 Para ayudarte mejor, escribinos por WhatsApp de soporte acá 👉 {support}\nEstamos atentos las 24hs 💪📲';
  cc.templates = templates;

  await db
    .update(clientSettings)
    .set({ chatConfig: cc, updatedAt: new Date() })
    .where(eq(clientSettings.tenantId, t.id));
  invalidateTenant('bblack');

  console.log('DESPUES landingDomain:', cc.landingDomain, '(vacío = default go.fichaslibres.online)');
  console.log('links.support:', supportUrl);
  console.log('templates.support:', templates.support);
  console.log('✓ bblack soporte corregido');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });

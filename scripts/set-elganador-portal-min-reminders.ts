import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { clientSettings } from '@/db/schema';
import { getTenantBySlug, invalidateTenant } from '@/lib/tenants';

// ElGanador: ganamosco.org dejó de abrir. Reemplazo por los dos dominios nuevos
// (primario ganamosnet.info; fallback ganamosonline.com). Mínimo $2000 y
// recordatorio a los 5 min (chat_config.reminders).
const PRIMARY = 'https://ganamosnet.info';
const FALLBACK = 'https://ganamosonline.com';
const PORTAL_LINE = `${PRIMARY}\nSi no abre, probá: ${FALLBACK}`;

async function main() {
  const t = await getTenantBySlug('elganador');
  if (!t) throw new Error('no tenant elganador');
  const [row] = await db.select().from(clientSettings).where(eq(clientSettings.tenantId, t.id)).limit(1);
  const cc = { ...((row?.chatConfig ?? {}) as Record<string, unknown>) };
  const links = { ...((cc.links as Record<string, string> | undefined) ?? {}) };
  const templates = { ...((cc.templates as Record<string, string> | undefined) ?? {}) };

  links.portal_play = PRIMARY;
  links.portal_login = PRIMARY;
  links.portal_forgot = PRIMARY;
  cc.links = links;
  cc.portalUrl = PRIMARY;
  cc.minDeposit = 2000;
  cc.reminders = true;

  const welcome = typeof templates.welcome_body === 'string' ? templates.welcome_body : '';
  templates.welcome_body = welcome.replace(/https?:\/\/ganamosco\.org[^\s]*/gi, PORTAL_LINE);
  cc.templates = templates;

  await db
    .insert(clientSettings)
    .values({ tenantId: t.id, chatConfig: cc })
    .onConflictDoUpdate({
      target: clientSettings.tenantId,
      set: { chatConfig: cc, updatedAt: new Date() },
    });
  invalidateTenant('elganador');

  console.log({
    portal: PRIMARY,
    fallback: FALLBACK,
    minDeposit: cc.minDeposit,
    reminders: cc.reminders,
    welcome: templates.welcome_body,
    links,
  });
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

// One-off: setea los dominios propios de casaurbana en chat_config.
//   landingDomain = go.trackerapp.site   (link del anuncio + walink)
//   chatDomain    = chat.trackerapp.site (origen del widget al redirigir)
// Idempotente: mergea sobre el chat_config existente sin pisar el resto.
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { tenants, clientSettings } from '../db/schema';

const SLUG = 'casaurbana';
const LANDING_DOMAIN = 'go.trackerapp.site';
const CHAT_DOMAIN = 'chat.trackerapp.site';

async function main() {
  const t = await db.query.tenants.findFirst({ where: eq(tenants.slug, SLUG) });
  if (!t) throw new Error(`no tenant ${SLUG}`);

  const [row] = await db.select({ chatConfig: clientSettings.chatConfig }).from(clientSettings).where(eq(clientSettings.tenantId, t.id));
  const prev = (row?.chatConfig ?? {}) as Record<string, unknown>;
  const next = { ...prev, landingDomain: LANDING_DOMAIN, chatDomain: CHAT_DOMAIN };

  await db
    .insert(clientSettings)
    .values({ tenantId: t.id, chatConfig: next })
    .onConflictDoUpdate({ target: clientSettings.tenantId, set: { chatConfig: next, updatedAt: new Date() } });

  console.log(`${SLUG}: landingDomain=${LANDING_DOMAIN} chatDomain=${CHAT_DOMAIN} ✓`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

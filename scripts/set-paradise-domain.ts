import { and, eq } from 'drizzle-orm';
import { db } from '../db';
import { tenants, clientSettings, landings } from '../db/schema';

// Paradise ads+chat en go.juegayahorra.online (same-origin). Soporte NO se mueve.
const SLUG = 'paradise';
const LANDING_DOMAIN = 'go.juegayahorra.online';
const SUPPORT = 'https://go.fichaslibres.online/l/paradise/walink?campaign=Soporte';
const HEADLINE = 'Hola! Vas a recibir atención, completá el siguiente formulario.';

async function main() {
  const t = await db.query.tenants.findFirst({ where: eq(tenants.slug, SLUG) });
  if (!t) throw new Error(`no tenant ${SLUG}`);

  const [row] = await db.select({ chatConfig: clientSettings.chatConfig }).from(clientSettings).where(eq(clientSettings.tenantId, t.id));
  const prev = (row?.chatConfig ?? {}) as Record<string, unknown>;
  const links = { ...((prev.links as Record<string, string> | undefined) ?? {}), support: SUPPORT };
  const next = {
    ...prev,
    landingDomain: LANDING_DOMAIN,
    waBtnUrl: SUPPORT,
    supportUrl: SUPPORT,
    links,
  };

  await db
    .insert(clientSettings)
    .values({ tenantId: t.id, chatConfig: next })
    .onConflictDoUpdate({ target: clientSettings.tenantId, set: { chatConfig: next, updatedAt: new Date() } });

  const chatRows = await db.select().from(landings).where(and(eq(landings.tenantId, t.id), eq(landings.active, true)));
  for (const lp of chatRows) {
    const c = (lp.config ?? {}) as Record<string, unknown>;
    if (typeof c.chatSlug !== 'string' || !String(c.chatSlug).trim()) continue;
    const cfg = {
      ...c,
      headline: HEADLINE,
      subtext: '',
      logoUrl: '',
      brandName: '',
      redirectDelayMs: 2500,
    };
    await db.update(landings).set({ name: 'Formulario', config: cfg, updatedAt: new Date() }).where(eq(landings.id, lp.id));
    console.log('landing', lp.landingSlug, '→ Formulario neutro');
  }

  console.log(JSON.stringify({
    landingDomain: LANDING_DOMAIN,
    chatDomain: (prev as { chatDomain?: string }).chatDomain ?? null,
    waBtnUrl: next.waBtnUrl,
    supportUrl: next.supportUrl,
    linksSupport: links.support,
  }, null, 2));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

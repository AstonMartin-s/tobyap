import { and, eq } from 'drizzle-orm';
import { db } from '../db';
import { tenants, clientSettings, landings } from '../db/schema';
import { JUEGA_LANDING_HOST } from '../lib/chat/adsIsolation';

// Ads+chat same-origin en go.juegayahorra.online. Soporte fichaslibres intacto.
const SLUGS = process.argv.slice(2).length ? process.argv.slice(2) : ['king', 'bblack'];
const HEADLINE = 'Hola! Vas a recibir atención, completá el siguiente formulario.';

function supportUrl(slug: string, prev: Record<string, unknown>): string {
  const links = (prev.links as Record<string, string> | undefined) ?? {};
  const existing = [links.support, prev.supportUrl, prev.waBtnUrl]
    .map((x) => (typeof x === 'string' ? x.trim() : ''))
    .find((x) => x && /fichaslibres|walink/i.test(x));
  return existing || `https://go.fichaslibres.online/l/${slug}/walink?campaign=Soporte`;
}

async function one(slug: string) {
  const t = await db.query.tenants.findFirst({ where: eq(tenants.slug, slug) });
  if (!t) throw new Error(`no tenant ${slug}`);

  const [row] = await db.select({ chatConfig: clientSettings.chatConfig }).from(clientSettings).where(eq(clientSettings.tenantId, t.id));
  const prev = (row?.chatConfig ?? {}) as Record<string, unknown>;
  const support = supportUrl(slug, prev);
  const links = { ...((prev.links as Record<string, string> | undefined) ?? {}), support };
  const next = {
    ...prev,
    landingDomain: JUEGA_LANDING_HOST,
    waBtnUrl: support,
    supportUrl: support,
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
    const cfg = { ...c, headline: HEADLINE, subtext: '', logoUrl: '', brandName: '', redirectDelayMs: 2500 };
    await db.update(landings).set({ name: 'Formulario', config: cfg, updatedAt: new Date() }).where(eq(landings.id, lp.id));
    console.log(`${slug} landing ${lp.landingSlug} → Formulario neutro`);
  }

  console.log(JSON.stringify({ slug, name: t.name, landingDomain: JUEGA_LANDING_HOST, support }, null, 2));
}

async function main() {
  for (const s of SLUGS) await one(s);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

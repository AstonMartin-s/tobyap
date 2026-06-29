import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { tenants, clientSettings, numbers, landings } from '@/db/schema';
import { LandingView, type LandingConfig } from '../../_landing';

export const dynamic = 'force-dynamic';

// Landing específica del cliente: /l/<slug>/<landingSlug>
export default async function NamedLanding({
  params,
}: {
  params: { slug: string; landing: string };
}) {
  const t = await db.query.tenants.findFirst({ where: eq(tenants.slug, params.slug) });
  if (!t || !t.active) {
    return <main style={{ padding: '20vh 1rem', textAlign: 'center' }}>Landing no disponible</main>;
  }

  const [lp] = await db
    .select()
    .from(landings)
    .where(and(eq(landings.tenantId, t.id), eq(landings.landingSlug, params.landing)))
    .limit(1);
  if (!lp || !lp.active) {
    return <main style={{ padding: '20vh 1rem', textAlign: 'center' }}>Landing no disponible</main>;
  }

  const [s] = await db.select().from(clientSettings).where(eq(clientSettings.tenantId, t.id));
  const [n] = await db
    .select()
    .from(numbers)
    .where(and(eq(numbers.tenantId, t.id), eq(numbers.type, 'publi'), eq(numbers.status, true)))
    .limit(1);

  const c = (lp.config ?? {}) as Record<string, string | number | null>;
  const cfg: LandingConfig = {
    tenantSlug: t.slug,
    pixelId: String(c.pixelId ?? t.metaPixelId ?? ''),
    waNumber: String(c.waNumber ?? n?.phone ?? '').replace(/\D/g, ''),
    message: String(c.message ?? s?.message ?? 'Hola, vi el anuncio y quiero mi beneficio'),
    brandName: c.brandName ? String(c.brandName) : t.name,
    primaryColor: c.primaryColor ? String(c.primaryColor) : undefined,
    headline: c.headline ? String(c.headline) : undefined,
    subtext: c.subtext ? String(c.subtext) : undefined,
    ccpp: c.ccpp != null ? String(c.ccpp) : null,
    campaign: c.campaign != null ? String(c.campaign) : null,
    redirectDelayMs: c.redirectDelayMs != null ? Number(c.redirectDelayMs) : undefined,
  };

  return <LandingView {...cfg} />;
}

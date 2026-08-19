import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { tenants, clientSettings, landings } from '@/db/schema';
import { getTenantBySlug } from '@/lib/tenants';
import { resolveBono } from '@/lib/attribution';
import { pickNumberByCategory } from '@/lib/rotation';
import { LandingView, landingMetadata, fichasFromBono, type LandingConfig } from '../_landing';

export const dynamic = 'force-dynamic';

// Resuelve el slug de la URL: primero como TENANT (landing por defecto del
// cliente), y si no matchea ninguno, como ALIAS de una landing puntual (URL
// corta que no expone el nombre del cliente: /l/<alias>).
async function resolveBySlugOrAlias(slug: string) {
  const direct = await getTenantBySlug(slug);
  if (direct) {
    const [lp] = await db
      .select()
      .from(landings)
      .where(and(eq(landings.tenantId, direct.id), eq(landings.active, true)))
      .limit(1);
    return { tenant: direct, landing: lp ?? null };
  }
  const [lp] = await db.select().from(landings).where(and(eq(landings.alias, slug), eq(landings.active, true))).limit(1);
  if (!lp) return null;
  const tenantRow = await db.query.tenants.findFirst({ where: eq(tenants.id, lp.tenantId) });
  if (!tenantRow) return null;
  const tenant = await getTenantBySlug(tenantRow.slug);
  if (!tenant) return null;
  return { tenant, landing: lp };
}

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams: { ccpp?: string };
}): Promise<Metadata> {
  const found = await resolveBySlugOrAlias(params.slug);
  if (!found) return {};
  const { tenant, landing: lp } = found;
  const c = (lp?.config ?? {}) as Record<string, string | null>;
  const fichas = fichasFromBono(resolveBono(tenant, searchParams.ccpp ?? (c.ccpp as string | undefined)));
  const h = headers();
  const base = `${h.get('x-forwarded-proto') ?? 'https'}://${h.get('host')}`;
  return landingMetadata({
    brand: c.brandName ? String(c.brandName) : tenant.name,
    fichas,
    logoAbs: c.logoUrl ? base + String(c.logoUrl) : null,
    url: `${base}/l/${params.slug}`,
  });
}

// Landing por defecto del cliente: /l/<slug>?wa=<numero opcional>
// Si el cliente tiene una landing activa cargada, usa su config; si no, arma una
// por defecto desde settings + número de publicidad. También resuelve por ALIAS
// (URL corta sin el nombre del cliente): /l/<alias>.
export default async function Landing({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams: { wa?: string };
}) {
  const found = await resolveBySlugOrAlias(params.slug);
  if (!found) {
    return <main style={{ padding: '20vh 1rem', textAlign: 'center' }}>Landing no disponible</main>;
  }
  const t = found.tenant;

  const [s] = await db.select().from(clientSettings).where(eq(clientSettings.tenantId, t.id));
  const lp = found.landing;
  const c = (lp?.config ?? {}) as Record<string, string | number | boolean | null>;
  // Rotación entre los números activos de la categoría (tipo) de la landing,
  // salvo que la landing pida número fijo (config.useFixedNumber).
  const rotated = c.useFixedNumber ? null : await pickNumberByCategory(t.id, lp?.type);
  // waNumber manual = solo fallback si no hay números en la categoría.
  const fixedWa = c.waNumber != null && String(c.waNumber).replace(/\D/g, '') !== '' ? c.waNumber : null;
  const cfg: LandingConfig = {
    tenantSlug: t.slug,
    pixelId: String(c.pixelId ?? t.metaPixelId ?? ''),
    waNumber: String(rotated ?? searchParams.wa ?? fixedWa ?? '').replace(/\D/g, ''),
    message: String(c.message ?? s?.message ?? 'Hola, vi el anuncio y quiero mi beneficio'),
    brandName: c.brandName ? String(c.brandName) : t.name,
    logoUrl: c.logoUrl ? String(c.logoUrl) : undefined,
    primaryColor: c.primaryColor ? String(c.primaryColor) : undefined,
    headline: c.headline ? String(c.headline) : undefined,
    subtext: c.subtext ? String(c.subtext) : undefined,
    ccpp: c.ccpp != null ? String(c.ccpp) : null,
    campaign: c.campaign != null ? String(c.campaign) : null,
    redirectDelayMs: c.redirectDelayMs != null ? Number(c.redirectDelayMs) : undefined,
    noCode: c.noCode === true,
  };

  return <LandingView {...cfg} />;
}

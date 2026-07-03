import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { tenants, clientSettings, landings } from '@/db/schema';
import { getTenantBySlug } from '@/lib/tenants';
import { resolveBono } from '@/lib/attribution';
import { pickPubliRotating } from '@/lib/rotation';
import { LandingView, landingMetadata, fichasFromBono, type LandingConfig } from '../_landing';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams: { ccpp?: string };
}): Promise<Metadata> {
  const tenant = await getTenantBySlug(params.slug);
  if (!tenant) return {};
  const [lp] = await db
    .select()
    .from(landings)
    .where(and(eq(landings.tenantId, tenant.id), eq(landings.active, true)))
    .limit(1);
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
// por defecto desde settings + número de publicidad.
export default async function Landing({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams: { wa?: string };
}) {
  const t = await db.query.tenants.findFirst({ where: eq(tenants.slug, params.slug) });
  if (!t || !t.active) {
    return <main style={{ padding: '20vh 1rem', textAlign: 'center' }}>Landing no disponible</main>;
  }

  const [s] = await db.select().from(clientSettings).where(eq(clientSettings.tenantId, t.id));
  // Rotación estricta round-robin entre los números publi activos.
  const rotated = await pickPubliRotating(t.id);
  const [lp] = await db
    .select()
    .from(landings)
    .where(and(eq(landings.tenantId, t.id), eq(landings.active, true)))
    .limit(1);

  const c = (lp?.config ?? {}) as Record<string, string | number | null>;
  const cfg: LandingConfig = {
    tenantSlug: t.slug,
    pixelId: String(c.pixelId ?? t.metaPixelId ?? ''),
    waNumber: String(c.waNumber ?? searchParams.wa ?? rotated ?? '').replace(/\D/g, ''),
    message: String(c.message ?? s?.message ?? 'Hola, vi el anuncio y quiero mi beneficio'),
    brandName: c.brandName ? String(c.brandName) : t.name,
    logoUrl: c.logoUrl ? String(c.logoUrl) : undefined,
    primaryColor: c.primaryColor ? String(c.primaryColor) : undefined,
    headline: c.headline ? String(c.headline) : undefined,
    subtext: c.subtext ? String(c.subtext) : undefined,
    ccpp: c.ccpp != null ? String(c.ccpp) : null,
    campaign: c.campaign != null ? String(c.campaign) : null,
    redirectDelayMs: c.redirectDelayMs != null ? Number(c.redirectDelayMs) : undefined,
  };

  return <LandingView {...cfg} />;
}

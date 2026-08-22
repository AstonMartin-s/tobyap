import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { tenants, clientSettings, landings } from '@/db/schema';
import { getTenantBySlug } from '@/lib/tenants';
import { resolveBono } from '@/lib/attribution';
import { pickNumberByCategory } from '@/lib/rotation';
import { LandingView, landingMetadata, fichasFromBono, type LandingConfig } from '../../_landing';

export const dynamic = 'force-dynamic';

function baseUrl(): string {
  const h = headers();
  return `${h.get('x-forwarded-proto') ?? 'https'}://${h.get('host')}`;
}

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: { slug: string; landing: string };
  searchParams: { ccpp?: string };
}): Promise<Metadata> {
  const tenant = await getTenantBySlug(params.slug);
  if (!tenant) return {};
  const [lp] = await db
    .select()
    .from(landings)
    .where(and(eq(landings.tenantId, tenant.id), eq(landings.landingSlug, params.landing)))
    .limit(1);
  const c = (lp?.config ?? {}) as Record<string, string | null>;
  const ccpp = searchParams.ccpp ?? (c.ccpp as string | undefined);
  const fichas = fichasFromBono(resolveBono(tenant, ccpp));
  const base = baseUrl();
  return landingMetadata({
    brand: c.brandName ? String(c.brandName) : tenant.name,
    fichas,
    logoAbs: c.logoUrl ? base + String(c.logoUrl) : null,
    url: `${base}/l/${params.slug}/${params.landing}`,
  });
}

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
  const c = (lp.config ?? {}) as Record<string, string | number | boolean | null>;
  const fixedWa =
    c.waNumber != null && String(c.waNumber).replace(/\D/g, '') !== ''
      ? String(c.waNumber).replace(/\D/g, '')
      : null;
  // Rotación round-robin entre los números ACTIVOS de la categoría (tipo) de la
  // landing. useFixedNumber solo bloquea rotación si hay waNumber configurado;
  // si está vacío, cae a rotación (evita "No disponible" con números soporte activos).
  const wantsFixed = c.useFixedNumber === true && fixedWa;
  const rotated = wantsFixed ? null : await pickNumberByCategory(t.id, lp.type);
  const cfg: LandingConfig = {
    tenantSlug: t.slug,
    pixelId: String(c.pixelId ?? t.metaPixelId ?? ''),
    waNumber: String(rotated ?? fixedWa ?? '').replace(/\D/g, ''),
    message: String(c.message ?? s?.message ?? 'Hola, vi el anuncio y quiero mi beneficio'),
    brandName: c.brandName ? String(c.brandName) : t.name,
    logoUrl: c.logoUrl ? String(c.logoUrl) : undefined,
    primaryColor: c.primaryColor ? String(c.primaryColor) : undefined,
    headline: c.headline ? String(c.headline) : undefined,
    subtext: c.subtext ? String(c.subtext) : undefined,
    ccpp: c.ccpp != null ? String(c.ccpp) : null,
    campaign: c.campaign != null ? String(c.campaign) : null,
    redirectDelayMs: c.redirectDelayMs != null ? Number(c.redirectDelayMs) : undefined,
    // Si la landing tiene chatSlug, redirige al chat web en vez de wa.me.
    chatSlug: c.chatSlug != null ? String(c.chatSlug) : null,
    chatOrigin: process.env.CHAT_ORIGIN || '', // ej https://chat.fichaslibres.online
    // Si tiene portalUrl, redirige a un portal externo del cliente con el token.
    portalUrl: c.portalUrl != null && String(c.portalUrl).trim() !== '' ? String(c.portalUrl) : null,
    // Si tiene redirectUrl, redirige tal cual (ej soporte wa.link) sin query extra.
    redirectUrl: c.redirectUrl != null && String(c.redirectUrl).trim() !== '' ? String(c.redirectUrl) : null,
    noCode: c.noCode === true || lp.type === 'soporte',
  };

  return <LandingView {...cfg} />;
}

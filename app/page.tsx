import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { and, eq, sql } from 'drizzle-orm';
import { getSession } from '@/lib/session';
import { db } from '@/db';
import { clientSettings, landings, tenants } from '@/db/schema';
import { getTenantBySlugAnyStatus } from '@/lib/tenants';
import { pickNumberByCategory } from '@/lib/rotation';
import { usesAdsSameOrigin } from '@/lib/chat/adsIsolation';
import { LandingView, type LandingConfig } from './l/_landing';

export const dynamic = 'force-dynamic';

// Dominio propio de cliente (ej volveapp.online) apuntado al mismo app: si el
// host de la request coincide con el landingDomain de un tenant, la RAÍZ sirve su
// landing. Si no coincide (dominio principal del panel), sigue el login/panel.
async function landingForHost() {
  const host = (headers().get('host') ?? '').toLowerCase().replace(/^www\./, '').split(':')[0];
  if (!host) return null;
  const [match] = await db
    .select({ tenantId: clientSettings.tenantId })
    .from(clientSettings)
    .where(sql`lower(regexp_replace(coalesce(${clientSettings.chatConfig} ->> 'landingDomain', ''), '^https?://', '')) = ${host}`)
    .limit(1);
  if (!match) return null;
  const [cs] = await db.select().from(clientSettings).where(eq(clientSettings.tenantId, match.tenantId)).limit(1);
  // Resolvemos el tenant y su primera landing activa (como /l/<slug>).
  const [slugRow] = await db.select({ slug: tenants.slug }).from(tenants).where(eq(tenants.id, match.tenantId)).limit(1);
  if (!slugRow) return null;
  const tenant = await getTenantBySlugAnyStatus(slugRow.slug);
  if (!tenant) return null;
  const [lp] = await db.select().from(landings).where(and(eq(landings.tenantId, tenant.id), eq(landings.active, true))).limit(1);
  if (!lp) return null;
  const c = (lp.config ?? {}) as Record<string, string | number | boolean | null>;
  const isolated = usesAdsSameOrigin(cs?.chatConfig) && !!c.chatSlug;
  const fixedWa = c.waNumber != null && String(c.waNumber).replace(/\D/g, '') !== '' ? String(c.waNumber).replace(/\D/g, '') : null;
  const wantsFixed = c.useFixedNumber === true && fixedWa;
  const rotated = wantsFixed ? null : await pickNumberByCategory(tenant.id, lp.type);
  const cfg: LandingConfig = {
    tenantSlug: tenant.slug,
    pixelId: String(c.pixelId ?? tenant.metaPixelId ?? ''),
    waNumber: String(rotated ?? fixedWa ?? '').replace(/\D/g, ''),
    message: String(c.message ?? 'Hola, vi el anuncio y quiero más información'),
    brandName: isolated ? (c.brandName ? String(c.brandName) : '') : (c.brandName ? String(c.brandName) : tenant.name),
    logoUrl: isolated ? undefined : (c.logoUrl ? String(c.logoUrl) : undefined),
    primaryColor: c.primaryColor ? String(c.primaryColor) : undefined,
    headline: c.headline ? String(c.headline) : undefined,
    subtext: c.subtext ? String(c.subtext) : undefined,
    ccpp: c.ccpp != null ? String(c.ccpp) : null,
    campaign: c.campaign != null ? String(c.campaign) : null,
    redirectDelayMs: c.redirectDelayMs != null ? Number(c.redirectDelayMs) : undefined,
    portalUrl: c.portalUrl != null && String(c.portalUrl).trim() !== '' ? String(c.portalUrl) : null,
    redirectUrl: c.redirectUrl != null && String(c.redirectUrl).trim() !== '' ? String(c.redirectUrl) : null,
    chatSlug: isolated && c.chatSlug ? String(c.chatSlug) : null,
    chatOrigin: isolated ? '' : undefined,
    noCode: c.noCode === true,
    neutralAds: isolated,
    leadEvent: c.leadEvent != null && String(c.leadEvent).trim() !== '' ? String(c.leadEvent) : null,
  };
  return cfg;
}

export default async function Home() {
  // Dominio propio de landing → servimos la landing en la raíz.
  const cfg = await landingForHost();
  if (cfg) return <LandingView {...cfg} />;

  const session = await getSession();
  if (!session) redirect('/login');
  if (session.role === 'admin') redirect('/admin');
  if (session.panelRole === 'operador') redirect('/chats');
  redirect('/reportes');
}

import { and, eq, gte, lte, sql } from 'drizzle-orm';
import { db } from '@/db';
import { metaEvents, tenants } from '@/db/schema';

// ---------------------------------------------------------------------------
// Reportes admin — agregan SIEMPRE desde nuestra DB (meta_events). El sistema es
// independiente del PAYBOT original (ver memoria tobyap-independiente).
//   eventType: conversacion (evento 1) | cargo (evento 2) | redirect (visita)
// ---------------------------------------------------------------------------

export interface ClientReport {
  tenantId: string;
  slug: string;
  name: string;
  conversaciones: number; // evento 1
  cargas: number; // evento 2
  redirects: number; // visitas
  conversion: number; // % cargas / conversaciones
}

// Reporte de UN cliente (su propia data), con filtros opcionales de campaña y fechas.
export interface ClientKpis {
  conversaciones: number;
  cargas: number;
  redirects: number;
  totalEvents: number;
  conversion: number;
  byCampaign: Array<{ campaign: string; conversaciones: number; cargas: number; redirects: number }>;
}

export async function getClientKpis(
  tenantId: string,
  opts: { campaign?: string; start?: string; end?: string } = {},
): Promise<ClientKpis> {
  const conds = [eq(metaEvents.tenantId, tenantId), ...range(opts.start, opts.end)];
  if (opts.campaign) conds.push(eq(metaEvents.campaignId, opts.campaign));

  const rows = await db
    .select({
      type: metaEvents.eventType,
      campaign: metaEvents.campaignId,
      n: sql<number>`count(*)::int`,
    })
    .from(metaEvents)
    .where(and(...conds))
    .groupBy(metaEvents.eventType, metaEvents.campaignId);

  let conversaciones = 0;
  let cargas = 0;
  let redirects = 0;
  const byCamp = new Map<string, { conversaciones: number; cargas: number; redirects: number }>();
  for (const r of rows) {
    if (r.type === 'conversacion') conversaciones += r.n;
    else if (r.type === 'cargo') cargas += r.n;
    else if (r.type === 'redirect') redirects += r.n;
    const key = r.campaign ?? '(sin campaña)';
    const c = byCamp.get(key) ?? { conversaciones: 0, cargas: 0, redirects: 0 };
    if (r.type === 'conversacion') c.conversaciones += r.n;
    else if (r.type === 'cargo') c.cargas += r.n;
    else if (r.type === 'redirect') c.redirects += r.n;
    byCamp.set(key, c);
  }

  const byCampaign = [...byCamp.entries()]
    .map(([campaign, v]) => ({ campaign, ...v }))
    .sort((a, b) => b.conversaciones - a.conversaciones);

  return {
    conversaciones,
    cargas,
    redirects,
    totalEvents: conversaciones + cargas,
    conversion: conversaciones ? +(100 * cargas / conversaciones).toFixed(1) : 0,
    byCampaign,
  };
}

function range(start?: string, end?: string) {
  const conds = [];
  if (start) conds.push(gte(metaEvents.sentAt, new Date(start)));
  if (end) conds.push(lte(metaEvents.sentAt, new Date(end)));
  return conds;
}

// Reporte por cliente (todos los tenants role='client'), opcional rango de fechas.
export async function getAdminReport(start?: string, end?: string): Promise<ClientReport[]> {
  const rows = await db
    .select({
      tenantId: tenants.id,
      slug: tenants.slug,
      name: tenants.name,
      eventType: metaEvents.eventType,
      n: sql<number>`count(${metaEvents.id})::int`,
    })
    .from(tenants)
    .leftJoin(metaEvents, and(eq(metaEvents.tenantId, tenants.id), ...range(start, end)))
    .where(eq(tenants.role, 'client'))
    .groupBy(tenants.id, tenants.slug, tenants.name, metaEvents.eventType);

  const map = new Map<string, ClientReport>();
  for (const r of rows) {
    let c = map.get(r.tenantId);
    if (!c) {
      c = { tenantId: r.tenantId, slug: r.slug, name: r.name, conversaciones: 0, cargas: 0, redirects: 0, conversion: 0 };
      map.set(r.tenantId, c);
    }
    if (r.eventType === 'conversacion') c.conversaciones += r.n;
    else if (r.eventType === 'cargo') c.cargas += r.n;
    else if (r.eventType === 'redirect') c.redirects += r.n;
  }

  const list = [...map.values()];
  for (const c of list) c.conversion = c.conversaciones ? +(100 * c.cargas / c.conversaciones).toFixed(1) : 0;
  list.sort((a, b) => b.conversaciones - a.conversaciones);
  return list;
}

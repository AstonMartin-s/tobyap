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

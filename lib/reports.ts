import { and, eq, gte, lte, sql } from 'drizzle-orm';
import { db } from '@/db';
import { metaEvents, tenants, ledger, influencerSpend } from '@/db/schema';

// ---------------------------------------------------------------------------
// Canal de la campaña. Convención operativa: toda campaña de influencer arranca
// con el prefijo "influ" (INFLU/Influ/influ). El resto es tráfico de Meta.
// Se usa para separar reportes por canal sin cambiar cómo se cargan las campañas.
// ---------------------------------------------------------------------------
export type Channel = 'meta' | 'influencer';

export function campaignChannel(campaign: string | null | undefined): Channel {
  return /^influ/i.test((campaign ?? '').trim()) ? 'influencer' : 'meta';
}

// Día (YYYY-MM-DD) en zona AR — usado para agrupar reportes diarios y el ledger.
const AR_TZ = 'America/Argentina/Buenos_Aires';
// TZ inyectada como literal (no parámetro) para que SELECT y GROUP BY generen la
// MISMA expresión; si fuera $param, Postgres las ve distintas y falla el group by.
const dayExpr = sql<string>`to_char(${metaEvents.sentAt} AT TIME ZONE 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD')`;

/** Campañas de testeo interno — las filas quedan en DB pero NO suman en reportes. */
export const REPORT_EXCLUDE_CAMPAIGNS = ['test'];

/** SQL: excluye eventos de campañas de prueba (case-insensitive). */
function notTestCampaign() {
  return sql`(lower(${metaEvents.campaignId}) not in ('test') OR ${metaEvents.campaignId} is null)`;
}

export function todayAR(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: AR_TZ }).format(new Date()); // YYYY-MM-DD
}

/** Desplaza un día AR (YYYY-MM-DD) por delta días. */
export function shiftDayAR(day: string, delta: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

export function lastNDaysRangeAR(days: number): { start: string; end: string } {
  const end = todayAR();
  const start = shiftDayAR(end, -(days - 1));
  return { start, end };
}

/** Serie de N días con ceros si falta fila en DB. */
export function buildDailyChartSeries(rows: DailyRow[], days = 3): Array<{ day: string; gasto: number; costPerCarga: number; cargas: number }> {
  const end = todayAR();
  const out: Array<{ day: string; gasto: number; costPerCarga: number; cargas: number }> = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = shiftDayAR(end, -i);
    const r = rows.find((x) => x.day === day);
    out.push({
      day,
      gasto: r?.gasto ?? 0,
      costPerCarga: r?.costPerCarga ?? 0,
      cargas: r?.cargas ?? 0,
    });
  }
  return out;
}

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
interface ChannelTotals {
  conversaciones: number;
  cargas: number;
  redirects: number;
}

export interface ClientKpis {
  conversaciones: number;
  cargas: number;
  redirects: number;
  totalEvents: number;
  conversion: number;
  byCampaign: Array<{ campaign: string; channel: Channel; conversaciones: number; cargas: number; redirects: number }>;
  // Totales por canal (siempre calculados sobre TODO el período, sin importar el
  // filtro de canal), para poder mostrar Meta e Influencer lado a lado.
  byChannel: { meta: ChannelTotals; influencer: ChannelTotals };
}

export async function getClientKpis(
  tenantId: string,
  opts: { campaign?: string; start?: string; end?: string; channel?: Channel } = {},
): Promise<ClientKpis> {
  const conds = [eq(metaEvents.tenantId, tenantId), notTestCampaign(), ...range(opts.start, opts.end)];
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

  const empty = (): ChannelTotals => ({ conversaciones: 0, cargas: 0, redirects: 0 });
  const byChannel = { meta: empty(), influencer: empty() };
  const byCamp = new Map<string, { channel: Channel; conversaciones: number; cargas: number; redirects: number }>();

  const bump = (t: ChannelTotals, type: string | null, n: number) => {
    if (type === 'conversacion') t.conversaciones += n;
    else if (type === 'cargo') t.cargas += n;
    else if (type === 'redirect') t.redirects += n;
  };

  for (const r of rows) {
    const channel = campaignChannel(r.campaign);
    // byChannel: siempre acumula ambos canales (para el resumen lado a lado).
    bump(byChannel[channel], r.type, r.n);
    // El detalle por campaña y los totales respetan el filtro de canal si vino.
    if (opts.channel && channel !== opts.channel) continue;
    const key = r.campaign ?? '(sin campaña)';
    const c = byCamp.get(key) ?? { channel, conversaciones: 0, cargas: 0, redirects: 0 };
    bump(c, r.type, r.n);
    byCamp.set(key, c);
  }

  const byCampaign = [...byCamp.entries()]
    .map(([campaign, v]) => ({ campaign, ...v }))
    .sort((a, b) => b.conversaciones - a.conversaciones);

  // Totales según canal filtrado (o todo si no hay filtro).
  const sel = opts.channel
    ? [byChannel[opts.channel]]
    : [byChannel.meta, byChannel.influencer];
  const conversaciones = sel.reduce((a, t) => a + t.conversaciones, 0);
  const cargas = sel.reduce((a, t) => a + t.cargas, 0);
  const redirects = sel.reduce((a, t) => a + t.redirects, 0);

  return {
    conversaciones,
    cargas,
    redirects,
    totalEvents: conversaciones + cargas,
    conversion: conversaciones ? +(100 * cargas / conversaciones).toFixed(1) : 0,
    byCampaign,
    byChannel,
  };
}

// ---------------------------------------------------------------------------
// Gasto de influencers — caja APARTE (no toca ledger ni el saldo del cliente).
// Solo trazabilidad para calcular CPA del canal influencer. Se carga por
// (tenant, campaña, día). Devuelve el total del período por campaña y global.
// ---------------------------------------------------------------------------
export interface InfluencerSpendSummary {
  total: number;
  byCampaign: Array<{ campaign: string; amount: number }>;
}

export async function getInfluencerSpend(
  tenantId: string,
  opts: { start?: string; end?: string } = {},
): Promise<InfluencerSpendSummary> {
  const conds = [eq(influencerSpend.tenantId, tenantId)];
  if (opts.start) conds.push(gte(influencerSpend.day, opts.start));
  if (opts.end) conds.push(lte(influencerSpend.day, opts.end));

  const rows = await db
    .select({ campaign: influencerSpend.campaign, amount: sql<number>`coalesce(sum(${influencerSpend.amount}),0)::float` })
    .from(influencerSpend)
    .where(and(...conds))
    .groupBy(influencerSpend.campaign);

  const byCampaign = rows
    .map((r) => ({ campaign: r.campaign, amount: r.amount }))
    .sort((a, b) => b.amount - a.amount);
  const total = byCampaign.reduce((a, r) => a + r.amount, 0);
  return { total, byCampaign };
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
    .leftJoin(metaEvents, and(eq(metaEvents.tenantId, tenants.id), notTestCampaign(), ...range(start, end)))
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

// ---------------------------------------------------------------------------
// Tarjetas del día (hoy AR): un resumen por cliente con actividad, con el gasto
// MANUAL del día cargado en el ledger -> costo por chat / carga.
// ---------------------------------------------------------------------------
export interface DayCard {
  tenantId: string;
  slug: string;
  name: string;
  chats: number; // conversaciones
  cargas: number;
  conversion: number;
  gasto: number; // manual (ledger)
  ingreso: number; // depósitos (ledger)
  costPerChat: number;
  costPerCarga: number;
}

export async function getDayCards(day = todayAR()): Promise<DayCard[]> {
  const ev = await db
    .select({ tenantId: metaEvents.tenantId, type: metaEvents.eventType, n: sql<number>`count(*)::int` })
    .from(metaEvents)
    .where(sql`${dayExpr} = ${day} AND ${notTestCampaign()}`)
    .groupBy(metaEvents.tenantId, metaEvents.eventType);

  const ts = await db.select({ id: tenants.id, slug: tenants.slug, name: tenants.name }).from(tenants).where(eq(tenants.role, 'client'));
  const led = await db.select().from(ledger).where(eq(ledger.day, day));
  const ledByTenant = new Map(led.map((l) => [l.tenantId, l]));

  const cards: DayCard[] = ts.map((t) => {
    const chats = ev.filter((e) => e.tenantId === t.id && e.type === 'conversacion').reduce((a, e) => a + e.n, 0);
    const cargas = ev.filter((e) => e.tenantId === t.id && e.type === 'cargo').reduce((a, e) => a + e.n, 0);
    const l = ledByTenant.get(t.id);
    const gasto = l?.gasto ?? 0;
    const ingreso = l?.ingreso ?? 0;
    return {
      tenantId: t.id, slug: t.slug, name: t.name, chats, cargas,
      conversion: chats ? +(100 * cargas / chats).toFixed(1) : 0,
      gasto, ingreso,
      costPerChat: chats ? +(gasto / chats).toFixed(2) : 0,
      costPerCarga: cargas ? +(gasto / cargas).toFixed(2) : 0,
    };
  });
  cards.sort((a, b) => (b.chats + b.cargas) - (a.chats + a.cargas));
  return cards;
}

// ---------------------------------------------------------------------------
// Reporte diario de ads: filas por (cliente, día) con chats/cargas + gasto e
// ingreso manuales -> $/chat, $/carga, conversión y balance.
// ---------------------------------------------------------------------------
export interface DailyRow {
  tenantId: string;
  slug: string;
  name: string;
  day: string;
  chats: number;
  cargas: number;
  gasto: number;
  recarga: number; // depósito/recarga manual del día (Historial)
  conversion: number;
  costPerChat: number;
  costPerCarga: number;
  saldo: number; // saldo corriente: Σ recargas − Σ gasto hasta ese día (por cliente)
}

export async function getDailyReport(opts: { start?: string; end?: string; tenantId?: string } = {}): Promise<DailyRow[]> {
  // El día se agrupa en hora AR (dayExpr), pero el filtro es sobre sentAt (UTC).
  // Ensanchamos ±1 día la ventana UTC para no cortar las cargas de la tarde/noche
  // AR (que en UTC caen al día siguiente) y luego recortamos por el día ya
  // convertido a AR (inRange). Robusto ante el offset y DST.
  const shift = (d: string, days: number) => {
    const x = new Date(`${d}T00:00:00.000Z`);
    x.setUTCDate(x.getUTCDate() + days);
    return x;
  };
  const inRange = (d: string) => (!opts.start || d >= opts.start) && (!opts.end || d <= opts.end);

  const conds = [];
  if (opts.start) conds.push(gte(metaEvents.sentAt, shift(opts.start, -1)));
  if (opts.end) conds.push(lte(metaEvents.sentAt, shift(opts.end, +2)));
  if (opts.tenantId) conds.push(eq(metaEvents.tenantId, opts.tenantId));
  conds.push(notTestCampaign());

  const ev = await db
    .select({ tenantId: metaEvents.tenantId, day: dayExpr, type: metaEvents.eventType, n: sql<number>`count(*)::int` })
    .from(metaEvents)
    .where(conds.length ? and(...conds) : undefined)
    .groupBy(metaEvents.tenantId, dayExpr, metaEvents.eventType);

  const ts = await db.select({ id: tenants.id, slug: tenants.slug, name: tenants.name }).from(tenants).where(eq(tenants.role, 'client'));
  const tById = new Map(ts.map((t) => [t.id, t]));
  const led = await db.select().from(ledger);
  const ledByKey = new Map(led.map((l) => [`${l.tenantId}|${l.day}`, l]));

  const map = new Map<string, DailyRow>();
  for (const e of ev) {
    const t = tById.get(e.tenantId);
    if (!t || !e.day || !inRange(e.day)) continue; // recorte preciso por día AR
    const key = `${e.tenantId}|${e.day}`;
    let r = map.get(key);
    if (!r) {
      const l = ledByKey.get(key);
      r = { tenantId: e.tenantId, slug: t.slug, name: t.name, day: e.day, chats: 0, cargas: 0, gasto: l?.gasto ?? 0, recarga: l?.ingreso ?? 0, conversion: 0, costPerChat: 0, costPerCarga: 0, saldo: 0 };
      map.set(key, r);
    }
    if (e.type === 'conversacion') r.chats += e.n;
    else if (e.type === 'cargo') r.cargas += e.n;
  }

  // Incluir también días que tienen gasto/recarga manual aunque no haya eventos,
  // para que el operador siempre tenga la fila donde editar.
  for (const l of led) {
    if (opts.tenantId && l.tenantId !== opts.tenantId) continue;
    if (!inRange(l.day)) continue;
    const t = tById.get(l.tenantId);
    if (!t) continue;
    const key = `${l.tenantId}|${l.day}`;
    if (!map.has(key)) {
      map.set(key, { tenantId: l.tenantId, slug: t.slug, name: t.name, day: l.day, chats: 0, cargas: 0, gasto: l.gasto ?? 0, recarga: l.ingreso ?? 0, conversion: 0, costPerChat: 0, costPerCarga: 0, saldo: 0 });
    }
  }

  // Días sin eventos (p. ej. tras reset de contadores) deben aparecer con 0/0.
  if (opts.tenantId) {
    const t = tById.get(opts.tenantId);
    if (t) {
      const rangeEnd = opts.end ?? todayAR();
      const tenantDays = [...map.values()].filter((r) => r.tenantId === opts.tenantId).map((r) => r.day);
      let fillStart: string | null = null;
      if (opts.start && opts.end) {
        fillStart = opts.start;
      } else if (opts.start) {
        fillStart = opts.start;
      } else if (tenantDays.length > 0) {
        const newest = tenantDays.reduce((a, b) => (a > b ? a : b));
        fillStart = shiftDayAR(newest, 1);
      }
      if (fillStart && fillStart <= rangeEnd) {
        for (let d = fillStart; d <= rangeEnd; d = shiftDayAR(d, 1)) {
          if (!inRange(d)) continue;
          const key = `${opts.tenantId}|${d}`;
          if (map.has(key)) continue;
          const l = ledByKey.get(key);
          map.set(key, {
            tenantId: opts.tenantId,
            slug: t.slug,
            name: t.name,
            day: d,
            chats: 0,
            cargas: 0,
            gasto: l?.gasto ?? 0,
            recarga: l?.ingreso ?? 0,
            conversion: 0,
            costPerChat: 0,
            costPerCarga: 0,
            saldo: 0,
          });
        }
      }
    }
  }

  const rows = [...map.values()];
  // Saldo corriente por cliente: Σ(recarga − gasto) de TODO el ledger del cliente
  // hasta ese día (incluye historia previa al rango mostrado).
  const ledByTenant = new Map<string, typeof led>();
  for (const l of led) {
    const arr = ledByTenant.get(l.tenantId) ?? [];
    arr.push(l);
    ledByTenant.set(l.tenantId, arr);
  }
  for (const r of rows) {
    r.conversion = r.chats ? +(100 * r.cargas / r.chats).toFixed(1) : 0;
    r.costPerChat = r.chats ? +(r.gasto / r.chats).toFixed(2) : 0;
    r.costPerCarga = r.cargas ? +(r.gasto / r.cargas).toFixed(2) : 0;
    const hist = ledByTenant.get(r.tenantId) ?? [];
    r.saldo = +hist
      .filter((l) => l.day <= r.day)
      .reduce((acc, l) => acc + (l.ingreso ?? 0) - (l.gasto ?? 0), 0)
      .toFixed(2);
  }
  rows.sort((a, b) => (a.day < b.day ? 1 : -1));
  return rows;
}

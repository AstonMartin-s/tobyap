import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { tenants } from '@/db/schema';
import { getSession } from '@/lib/session';
import {
  buildSeriesFromDailyRows,
  getAttributionBreakdown,
  getClientKpis,
  getDailyReport,
  getInfluencerSpend,
  getSpendTotals,
  lastNDaysRangeAR,
} from '@/lib/reports';
import { Nav } from '../../_components/Nav';
import { DailyReportClient } from '../DailyReportClient';
import { DailyAdsCharts } from '../../reportes/DailyAdsCharts';

export const dynamic = 'force-dynamic';

const fmt = (n: number) => n.toLocaleString('es-AR');
const money = (n: number) => `$${n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default async function TrazabilidadPage({
  searchParams,
}: {
  searchParams: { tenant?: string; start?: string; end?: string };
}) {
  const session = await getSession();
  if (!session) redirect('/login');
  if (session.role !== 'admin') redirect('/reportes');

  const clientList = await db
    .select({ slug: tenants.slug, name: tenants.name, id: tenants.id })
    .from(tenants)
    .where(eq(tenants.role, 'client'));

  const selected = clientList.find((c) => c.slug === searchParams.tenant);

  // Rango por defecto: últimos 14 días (AR). El usuario puede acotar.
  const defRange = lastNDaysRangeAR(14);
  const start = searchParams.start ?? defRange.start;
  const end = searchParams.end ?? defRange.end;

  return (
    <>
      <Nav slug={session.slug} role="admin" />
      <main className="shell">
        <div className="page-head">
          <div className="page-head__text">
            <h1>Trazabilidad por cliente</h1>
            <p>Elegí un cliente para ver todo su abanico: campañas, historial, gasto, costo por chat, atribución y gráficos.</p>
          </div>
        </div>

        {/* Selector de cliente + rango */}
        <div className="card">
          <form method="get" className="row" style={{ alignItems: 'flex-end', flexWrap: 'wrap', gap: '.8rem' }}>
            <div className="field" style={{ margin: 0, minWidth: 220 }}>
              <label>Cliente</label>
              <select className="select" name="tenant" defaultValue={searchParams.tenant ?? ''}>
                <option value="">— Elegí un cliente —</option>
                {clientList.map((c) => <option key={c.slug} value={c.slug}>{c.name} · {c.slug}</option>)}
              </select>
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label>Desde</label>
              <input className="input" type="date" name="start" defaultValue={start} />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label>Hasta</label>
              <input className="input" type="date" name="end" defaultValue={end} />
            </div>
            <button className="btn" type="submit">Ver trazabilidad</button>
          </form>
        </div>

        {!selected ? (
          <div className="card"><div className="empty">Seleccioná un cliente para abrir su trazabilidad completa.</div></div>
        ) : (
          <TrazabilidadCliente
            tenantId={selected.id}
            slug={selected.slug}
            name={selected.name}
            start={start}
            end={end}
          />
        )}
      </main>
    </>
  );
}

async function TrazabilidadCliente({
  tenantId,
  slug,
  name,
  start,
  end,
}: {
  tenantId: string;
  slug: string;
  name: string;
  start: string;
  end: string;
}) {
  const [kpis, daily, influSpend, spend, attribution] = await Promise.all([
    getClientKpis(tenantId, {
      start: `${start}T00:00:00.000Z`,
      end: `${end}T23:59:59.999Z`,
    }),
    getDailyReport({ start, end, tenantId }),
    getInfluencerSpend(tenantId, { start, end }),
    getSpendTotals(tenantId, { start, end }),
    getAttributionBreakdown(tenantId, {
      start: `${start}T00:00:00.000Z`,
      end: `${end}T23:59:59.999Z`,
    }),
  ]);

  const tot = daily.reduce(
    (a, r) => ({ chats: a.chats + r.chats, cargas: a.cargas + r.cargas }),
    { chats: 0, cargas: 0 },
  );
  const saldoActual = daily.length ? daily[0].saldo : 0;
  const costPerChat = tot.chats ? spend.total / tot.chats : 0;
  const costPerCarga = tot.cargas ? spend.total / tot.cargas : 0;
  const convTot = tot.chats ? +(100 * tot.cargas / tot.chats).toFixed(1) : 0;
  const series = buildSeriesFromDailyRows(daily);
  const chartTot = daily.reduce(
    (a, r) => ({ chats: a.chats + r.chats, cargas: a.cargas + r.cargas, gasto: a.gasto + r.gasto, recarga: a.recarga + r.recarga }),
    { chats: 0, cargas: 0, gasto: 0, recarga: 0 },
  );

  return (
    <>
      <div className="page-head" style={{ marginTop: '.4rem' }}>
        <div className="page-head__text">
          <h2 style={{ margin: 0 }}>{name} <span style={{ color: 'var(--muted)', fontWeight: 400, fontSize: '.9rem' }}>· {slug} · {start} → {end}</span></h2>
        </div>
        <div className="page-head__actions">
          <a className="btn btn--ghost btn--sm" href={`/admin/clientes/${slug}`}>Configurar cliente →</a>
        </div>
      </div>

      {/* KPIs principales */}
      <div className="kpis">
        <div className="kpi kpi--blue">
          <div className="kpi__label">Chats (conversaciones)</div>
          <div className="kpi__value">{fmt(kpis.conversaciones)}</div>
          <div className="kpi__hint">Visitas landing: {fmt(kpis.redirects)}</div>
        </div>
        <div className="kpi kpi--green">
          <div className="kpi__label">Cargas</div>
          <div className="kpi__value">{fmt(kpis.cargas)}</div>
          <div className="kpi__hint">Conversión {convTot}%</div>
        </div>
        <div className="kpi kpi--accent">
          <div className="kpi__label">Gasto total</div>
          <div className="kpi__value">{money(spend.total)}</div>
          <div className="kpi__hint">Meta {money(spend.meta)} · Influencer {money(spend.influencer)}</div>
        </div>
        <div className="kpi kpi--purple">
          <div className="kpi__label">Costo por chat</div>
          <div className="kpi__value">{money(costPerChat)}</div>
          <div className="kpi__hint">Costo/carga {money(costPerCarga)}</div>
        </div>
      </div>

      {/* Resumen por canal */}
      <div className="card">
        <div className="card__title">Canales <span className="card__sub">Meta vs Influencers · influencer = campañas que empiezan con INFLU</span></div>
        <div className="grid-2">
          <div className="kpi kpi--blue">
            <div className="kpi__label">📣 Meta</div>
            <div className="kpi__value">{fmt(kpis.byChannel.meta.cargas)} cargas</div>
            <div className="kpi__hint">{fmt(kpis.byChannel.meta.conversaciones)} chats · {kpis.byChannel.meta.conversaciones ? (100 * kpis.byChannel.meta.cargas / kpis.byChannel.meta.conversaciones).toFixed(1) : 0}% conv.</div>
          </div>
          <div className="kpi kpi--purple">
            <div className="kpi__label">⭐ Influencers</div>
            <div className="kpi__value">{fmt(kpis.byChannel.influencer.cargas)} cargas</div>
            <div className="kpi__hint">
              {fmt(kpis.byChannel.influencer.conversaciones)} chats · {kpis.byChannel.influencer.conversaciones ? (100 * kpis.byChannel.influencer.cargas / kpis.byChannel.influencer.conversaciones).toFixed(1) : 0}% conv.
              {influSpend.total > 0 && kpis.byChannel.influencer.cargas > 0 && <> · CPA {money(influSpend.total / kpis.byChannel.influencer.cargas)}</>}
            </div>
          </div>
        </div>
      </div>

      {/* Rendimiento por campaña */}
      <div className="card">
        <div className="card__title">Rendimiento por campaña <span className="card__sub">conversión = cargas / conversaciones</span></div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Campaña</th><th>Canal</th>
                <th className="num">Conversaciones</th><th className="num">Cargas</th>
                <th className="num">Visitas</th><th className="num">% Conv.</th>
              </tr>
            </thead>
            <tbody>
              {kpis.byCampaign.length === 0 && <tr><td colSpan={6} className="empty">Sin eventos en el período.</td></tr>}
              {kpis.byCampaign.map((c) => (
                <tr key={c.campaign}>
                  <td>{c.campaign}</td>
                  <td>{c.channel === 'influencer' ? '⭐ Influencer' : '📣 Meta'}</td>
                  <td className="num">{fmt(c.conversaciones)}</td>
                  <td className="num">{fmt(c.cargas)}</td>
                  <td className="num">{fmt(c.redirects)}</td>
                  <td className="num" style={{ color: 'var(--accent)' }}>{c.conversaciones ? `${(100 * c.cargas / c.conversaciones).toFixed(1)}%` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Atribución (visitas con token PB*) */}
      <div className="card">
        <div className="card__title">
          Atribución por código <span className="card__sub">visitas con token · match contra leads del CRM</span>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Campaña</th><th>CCPP</th><th>Bono</th>
                <th className="num">Visitas</th><th className="num">Matcheadas</th><th className="num">% Match</th>
              </tr>
            </thead>
            <tbody>
              {attribution.rows.length === 0 && <tr><td colSpan={6} className="empty">Sin atribuciones con token en el período.</td></tr>}
              {attribution.rows.map((r, i) => (
                <tr key={`${r.campaign}-${r.ccpp}-${r.bono}-${i}`}>
                  <td>{r.campaign}</td>
                  <td>{r.ccpp}</td>
                  <td>{r.bono}</td>
                  <td className="num">{fmt(r.visitas)}</td>
                  <td className="num">{fmt(r.matcheadas)}</td>
                  <td className="num" style={{ color: 'var(--accent)' }}>{r.matchRate}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {attribution.totalVisitas > 0 && (
          <p style={{ color: 'var(--muted)', fontSize: '.8rem', margin: '.6rem 0 0' }}>
            Total: {fmt(attribution.totalVisitas)} visitas · {fmt(attribution.totalMatched)} matcheadas ({attribution.totalVisitas ? (100 * attribution.totalMatched / attribution.totalVisitas).toFixed(1) : 0}%)
          </p>
        )}
      </div>

      {/* Gráficos */}
      <div className="card">
        <div className="card__title">Gráficos <span className="card__sub">evolución diaria del período</span></div>
        <DailyAdsCharts data={series} />
      </div>

      {/* Historial diario editable (ledger) */}
      <div className="card">
        <div className="card__title">
          Historial diario <span className="card__sub">chats/cargas + gasto e ingreso editables (saldo del cliente)</span>
        </div>
        <DailyReportClient initial={daily} />
        <p style={{ color: 'var(--muted-2)', fontSize: '.78rem', marginTop: '.6rem', marginBottom: 0 }}>
          Totales período: {fmt(chartTot.chats)} chats · {fmt(chartTot.cargas)} cargas · gasto {money(chartTot.gasto)} · recarga {money(chartTot.recarga)} · saldo actual {money(saldoActual)}
        </p>
      </div>
    </>
  );
}

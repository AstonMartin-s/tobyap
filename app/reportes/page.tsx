import { redirect } from 'next/navigation';
import { getSession, canAccess, isPanelAdmin } from '@/lib/session';
import { getTenantBySlug } from '@/lib/tenants';
import {
  buildDailyChartSeries,
  getClientKpis,
  getDailyReport,
  getInfluencerSpend,
  lastNDaysRangeAR,
  type Channel,
} from '@/lib/reports';
import { Nav } from '../_components/Nav';
import { DailyAdsCharts } from './DailyAdsCharts';
import { DailyAdsTable } from './DailyAdsTable';
import { InfluencerSpend } from './InfluencerSpend';

export const dynamic = 'force-dynamic';

const fmt = (n: number) => n.toLocaleString('es-AR');
const money = (n: number) => n.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

export default async function ReportesPage({
  searchParams,
}: {
  searchParams: { campaign?: string; start?: string; end?: string; channel?: string };
}) {
  const session = await getSession();
  if (!session) redirect('/login');
  if (session.role === 'admin') redirect('/admin');
  if (!canAccess(session.panelRole, 'reportes')) redirect('/chats');
  const tenantF = await getTenantBySlug(session.slug);
  if (tenantF && !tenantF.features.reportes) redirect('/chats');
  // Nicho TIENDA: sin canales Meta/Influencers ni gasto de ads; "cargas" = "ventas".
  const isTienda = tenantF?.niche === 'tienda';
  const L = isTienda
    ? { Cargas: 'Ventas', cargas: 'ventas', evento2: 'Compras (evento 2)', totalHint: 'Conversaciones + ventas' }
    : { Cargas: 'Cargas', cargas: 'cargas', evento2: 'Depósitos (evento 2)', totalHint: 'Conversaciones + cargas' };

  const channel: Channel | undefined =
    searchParams.channel === 'meta' || searchParams.channel === 'influencer' ? searchParams.channel : undefined;
  const isAdmin = isPanelAdmin(session.panelRole);
  const chartRange = lastNDaysRangeAR(3);

  const [k, daily, chartRows, influSpend] = await Promise.all([
    getClientKpis(session.tenantId, {
      campaign: searchParams.campaign || undefined,
      channel,
      start: searchParams.start ? `${searchParams.start}T00:00:00.000Z` : undefined,
      end: searchParams.end ? `${searchParams.end}T23:59:59.999Z` : undefined,
    }),
    getDailyReport({
      start: searchParams.start,
      end: searchParams.end,
      tenantId: session.tenantId,
      channel,
    }),
    getDailyReport({
      start: chartRange.start,
      end: chartRange.end,
      tenantId: session.tenantId,
      channel,
    }),
    getInfluencerSpend(session.tenantId, { start: searchParams.start, end: searchParams.end }),
  ]);

  const conv = (t: { conversaciones: number; cargas: number }) =>
    t.conversaciones ? +(100 * t.cargas / t.conversaciones).toFixed(1) : 0;
  const influCpa = k.byChannel.influencer.cargas ? influSpend.total / k.byChannel.influencer.cargas : 0;
  const qs = (ch: string) => {
    const p = new URLSearchParams();
    if (searchParams.campaign) p.set('campaign', searchParams.campaign);
    if (searchParams.start) p.set('start', searchParams.start);
    if (searchParams.end) p.set('end', searchParams.end);
    if (ch) p.set('channel', ch);
    const s = p.toString();
    return s ? `/reportes?${s}` : '/reportes';
  };

  const chartData = buildDailyChartSeries(chartRows, 3);

  const tot = daily.reduce(
    (a, r) => ({ chats: a.chats + r.chats, cargas: a.cargas + r.cargas, gasto: a.gasto + r.gasto, recarga: a.recarga + r.recarga }),
    { chats: 0, cargas: 0, gasto: 0, recarga: 0 },
  );
  const convTot = tot.chats ? +(100 * tot.cargas / tot.chats).toFixed(1) : 0;
  const saldoFinal = daily.length ? daily[0].saldo : 0;

  return (
    <>
      <Nav slug={session.slug} role={session.role} panelRole={session.panelRole} />
      <main className="shell">
        <div className="page-head">
          <div className="page-head__text">
            <h1>Reportes</h1>
            <p>Estadísticas y análisis de eventos de tu cuenta.</p>
          </div>
        </div>

        {/* Resumen por canal: Meta vs Influencers (todo el período/filtro de fechas). */}
        {!isTienda && (
        <div className="card">
          <div className="card__title">
            Canales <span className="card__sub">Meta vs Influencers · influencer = campañas que empiezan con INFLU</span>
          </div>
          <div className="grid-2">
            <div className="kpi kpi--blue">
              <div className="kpi__label">📣 Meta</div>
              <div className="kpi__value">{fmt(k.byChannel.meta.cargas)} cargas</div>
              <div className="kpi__hint">{fmt(k.byChannel.meta.conversaciones)} conversaciones · {conv(k.byChannel.meta)}% conv.</div>
            </div>
            <div className="kpi kpi--purple">
              <div className="kpi__label">⭐ Influencers</div>
              <div className="kpi__value">{fmt(k.byChannel.influencer.cargas)} cargas</div>
              <div className="kpi__hint">
                {fmt(k.byChannel.influencer.conversaciones)} conversaciones · {conv(k.byChannel.influencer)}% conv.
                {influSpend.total > 0 && <> · CPA ${money(influCpa)}</>}
              </div>
            </div>
          </div>
          <div className="row" style={{ marginTop: '.7rem', gap: '.4rem' }}>
            <span style={{ fontSize: '.82rem', color: 'var(--muted)', marginRight: '.3rem' }}>Ver:</span>
            <a className={`btn btn--sm ${!channel ? '' : 'btn--ghost'}`} href={qs('')}>Todos</a>
            <a className={`btn btn--sm ${channel === 'meta' ? '' : 'btn--ghost'}`} href={qs('meta')}>Meta</a>
            <a className={`btn btn--sm ${channel === 'influencer' ? '' : 'btn--ghost'}`} href={qs('influencer')}>Influencers</a>
          </div>
        </div>
        )}

        {!isTienda && isAdmin && channel === 'influencer' && <InfluencerSpend start={searchParams.start} end={searchParams.end} />}

        {!isTienda && (
        <div className="card">
          <div className="card__title">
            Reportes diarios de ads
            <span className="card__sub">gasto/recarga cargados por el administrador</span>
          </div>
          <DailyAdsTable daily={daily} tot={tot} convTot={convTot} saldoFinal={saldoFinal} />
          <DailyAdsCharts data={chartData} />
        </div>
        )}

        <form method="get" className="card" style={{ paddingBottom: '1.1rem' }}>
          <div className="card__title">
            <span className="ico">⛂</span> Filtros
          </div>
          <div className="grid-2">
            <div className="field">
              <label>ID de campaña</label>
              <input className="input" name="campaign" defaultValue={searchParams.campaign} placeholder="Ej: CC1" />
            </div>
            <div />
            <div className="field">
              <label>Fecha inicio</label>
              <input className="input" type="date" name="start" defaultValue={searchParams.start} />
            </div>
            <div className="field">
              <label>Fecha fin</label>
              <input className="input" type="date" name="end" defaultValue={searchParams.end} />
            </div>
          </div>
          <div className="row">
            <button className="btn" type="submit">Aplicar filtros</button>
            <a className="btn btn--ghost" href="/reportes">Limpiar</a>
          </div>
        </form>

        <div className="kpis">
          <div className="kpi kpi--accent">
            <div className="kpi__icon">◷</div>
            <div className="kpi__label">Total de eventos</div>
            <div className="kpi__value">{fmt(k.totalEvents)}</div>
            <div className="kpi__hint">{L.totalHint}</div>
          </div>
          <div className="kpi kpi--blue">
            <div className="kpi__icon">↗</div>
            <div className="kpi__label">Conversaciones</div>
            <div className="kpi__value">{fmt(k.conversaciones)}</div>
            <div className="kpi__hint">Chats iniciados (evento 1)</div>
          </div>
          <div className="kpi kpi--green">
            <div className="kpi__icon">⚡</div>
            <div className="kpi__label">{L.Cargas}</div>
            <div className="kpi__value">{fmt(k.cargas)}</div>
            <div className="kpi__hint">{L.evento2}</div>
          </div>
          <div className="kpi kpi--purple">
            <div className="kpi__icon">→</div>
            <div className="kpi__label">Redirecciones</div>
            <div className="kpi__value">{fmt(k.redirects)}</div>
            <div className="kpi__hint">Visitas a la landing</div>
          </div>
        </div>

        <div className="card">
          <div className="card__title">
            Rendimiento por campaña
            <span className="card__sub">
              conversión = {L.cargas} / conversaciones{!isTienda && channel ? ` · filtrando: ${channel === 'meta' ? 'Meta' : 'Influencers'}` : ''}
            </span>
          </div>
          <table className="table">
            <thead>
              <tr>
                <th>Campaña</th>
                {!isTienda && <th>Canal</th>}
                <th className="num">Conversaciones</th>
                <th className="num">{L.Cargas}</th>
                <th className="num">Redirecciones</th>
                <th className="num">% Conv.</th>
              </tr>
            </thead>
            <tbody>
              {k.byCampaign.length === 0 && (
                <tr><td colSpan={isTienda ? 5 : 6} className="empty">Todavía no hay eventos en este período.</td></tr>
              )}
              {k.byCampaign.map((c) => (
                <tr key={c.campaign}>
                  <td>{c.campaign}</td>
                  {!isTienda && <td>{c.channel === 'influencer' ? '⭐ Influencer' : '📣 Meta'}</td>}
                  <td className="num">{fmt(c.conversaciones)}</td>
                  <td className="num">{fmt(c.cargas)}</td>
                  <td className="num">{fmt(c.redirects)}</td>
                  <td className="num" style={{ color: 'var(--accent)' }}>
                    {c.conversaciones ? `${(100 * c.cargas / c.conversaciones).toFixed(1)}%` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

      </main>
    </>
  );
}

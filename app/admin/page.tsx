import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { getAdminReport } from '@/lib/reports';
import { Nav } from '../_components/Nav';

export const dynamic = 'force-dynamic';

const fmt = (n: number) => n.toLocaleString('es-AR');

export default async function AdminPage({
  searchParams,
}: {
  searchParams: { start?: string; end?: string };
}) {
  const session = await getSession();
  if (!session) redirect('/login');
  if (session.role !== 'admin') redirect('/reportes');

  const start = searchParams.start;
  const end = searchParams.end;
  const report = await getAdminReport(start ? `${start}T00:00:00.000Z` : undefined, end ? `${end}T23:59:59.999Z` : undefined);
  const tot = report.reduce((a, c) => ({ conv: a.conv + c.conversaciones, carg: a.carg + c.cargas, red: a.red + c.redirects }), { conv: 0, carg: 0, red: 0 });

  return (
    <>
      <Nav slug={session.slug} role="admin" />
      <main className="shell">
        <div className="page-head">
          <div className="page-head__text">
            <h1>Reportes · todos los clientes</h1>
            <p>Resultados agregados desde la base propia.</p>
          </div>
        </div>

        <form method="get" className="card" style={{ paddingBottom: '1.1rem' }}>
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <div className="field" style={{ margin: 0 }}>
              <label>Desde</label>
              <input className="input" type="date" name="start" defaultValue={start} />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label>Hasta</label>
              <input className="input" type="date" name="end" defaultValue={end} />
            </div>
            <button className="btn" type="submit">Filtrar</button>
            <a className="btn btn--ghost" href="/admin">Limpiar</a>
          </div>
        </form>

        <div className="kpis">
          <div className="kpi"><div className="kpi__icon">↗</div><div className="kpi__label">Conversaciones</div><div className="kpi__value">{fmt(tot.conv)}</div></div>
          <div className="kpi kpi--warn"><div className="kpi__icon">⚡</div><div className="kpi__label">Cargas</div><div className="kpi__value">{fmt(tot.carg)}</div></div>
          <div className="kpi kpi--blue"><div className="kpi__icon">→</div><div className="kpi__label">Redirecciones</div><div className="kpi__value">{fmt(tot.red)}</div></div>
          <div className="kpi kpi--accent"><div className="kpi__icon">%</div><div className="kpi__label">Conversión global</div><div className="kpi__value">{tot.conv ? +(100 * tot.carg / tot.conv).toFixed(1) : 0}%</div></div>
        </div>

        <div className="card">
          <div className="card__title">Por cliente</div>
          <table className="table">
            <thead><tr><th>Cliente</th><th className="num">Conversaciones</th><th className="num">Cargas</th><th className="num">Redirects</th><th className="num">% Conv.</th></tr></thead>
            <tbody>
              {report.length === 0 && <tr><td colSpan={5} className="empty">Sin clientes.</td></tr>}
              {report.map((c) => (
                <tr key={c.tenantId}>
                  <td>{c.name} <span style={{ color: 'var(--muted)' }}>· {c.slug}</span></td>
                  <td className="num">{fmt(c.conversaciones)}</td>
                  <td className="num">{fmt(c.cargas)}</td>
                  <td className="num">{fmt(c.redirects)}</td>
                  <td className="num" style={{ color: 'var(--accent)' }}>{c.conversion}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </>
  );
}

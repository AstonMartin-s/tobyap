import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { tenants } from '@/db/schema';
import { getSession } from '@/lib/session';
import { getDayCards, getDailyReport, todayAR } from '@/lib/reports';
import { Nav } from '../_components/Nav';
import { DailyReportClient } from './DailyReportClient';

export const dynamic = 'force-dynamic';

const money = (n: number) => `$${n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default async function AdminPage({
  searchParams,
}: {
  searchParams: { start?: string; end?: string; tenant?: string };
}) {
  const session = await getSession();
  if (!session) redirect('/login');
  if (session.role !== 'admin') redirect('/reportes');

  const today = todayAR();
  const start = searchParams.start ?? today;
  const end = searchParams.end ?? today;

  const clientList = await db
    .select({ slug: tenants.slug, name: tenants.name, id: tenants.id })
    .from(tenants)
    .where(eq(tenants.role, 'client'));
  const selected = clientList.find((c) => c.slug === searchParams.tenant);

  const [cards, daily] = await Promise.all([
    getDayCards(today),
    getDailyReport({ start, end, tenantId: selected?.id }),
  ]);

  const activos = cards.filter((c) => c.chats + c.cargas > 0);
  const inactivos = cards.filter((c) => c.chats + c.cargas === 0);

  return (
    <>
      <Nav slug={session.slug} role="admin" />
      <main className="shell">
        <div className="page-head">
          <div className="page-head__text">
            <h1>Panel de administración</h1>
            <p>Estadísticas por cliente · el gasto se carga manual y queda fijo.</p>
          </div>
        </div>

        {/* ---- Reporte del día (tarjetas) ---- */}
        <div className="card">
          <div className="card__title">
            Reporte del día <span className="card__sub">{today} · {cards.length} clientes · con actividad {activos.length}</span>
          </div>
          {activos.length === 0 ? (
            <div className="empty">Todavía no hay actividad hoy.</div>
          ) : (
            <div className="daycards">
              {activos.map((c) => (
                <div className="daycard" key={c.tenantId}>
                  <div className="daycard__head">
                    <div>
                      <div className="daycard__name">{c.name}</div>
                      <div className="daycard__sub">{c.slug}</div>
                    </div>
                    <span className="badge badge--green">{c.conversion}%</span>
                  </div>
                  <div className="daycard__grid">
                    <div className="daycard__cell"><div className="l">Chats</div><div className="v">{c.chats}</div></div>
                    <div className="daycard__cell"><div className="l">Cargas</div><div className="v" style={{ color: 'var(--accent)' }}>{c.cargas}</div></div>
                    <div className="daycard__cell"><div className="l">Gasto</div><div className="v" style={{ color: 'var(--blue)' }}>{money(c.gasto)}</div></div>
                    <div className="daycard__cell"><div className="l">Costo/Chat</div><div className="v">{money(c.costPerChat)}</div></div>
                  </div>
                  <div className="daycard__foot">
                    <span>Costo/Carga <b>{money(c.costPerCarga)}</b></span>
                    <span>Conversión <b style={{ color: 'var(--accent)' }}>{c.conversion}%</b></span>
                  </div>
                </div>
              ))}
            </div>
          )}
          {inactivos.length > 0 && (
            <p style={{ color: 'var(--muted-2)', fontSize: '.8rem', marginTop: '1rem', marginBottom: 0 }}>
              Sin actividad hoy: {inactivos.map((c) => c.slug).join(' · ')}
            </p>
          )}
        </div>

        {/* ---- Reportes diarios (tabla editable) ---- */}
        <div className="card">
          <div className="card__title">
            Reportes diarios de ads <span className="card__sub">cargá el gasto en la fila — se guarda solo</span>
          </div>
          <form method="get" className="row" style={{ alignItems: 'flex-end', marginBottom: '1.1rem', flexWrap: 'wrap' }}>
            <div className="field" style={{ margin: 0, minWidth: 200 }}>
              <label>Cliente</label>
              <select className="select" name="tenant" defaultValue={searchParams.tenant ?? ''}>
                <option value="">Todos los clientes</option>
                {clientList.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
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
            <button className="btn" type="submit">Filtrar</button>
            <a className="btn btn--ghost" href="/admin">Hoy</a>
          </form>
          {!selected && <p style={{ color: 'var(--muted-2)', fontSize: '.78rem', marginTop: 0 }}>Elegí un cliente para ver el saldo de su cuenta correctamente.</p>}
          <DailyReportClient initial={daily} />
        </div>
      </main>
    </>
  );
}

import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { getAdminReport } from '@/lib/reports';
import { Nav } from '../_components/Nav';

export const dynamic = 'force-dynamic';

// Panel ADMIN (operador) — solo role='admin'. Reportes 100% desde nuestra DB.
export default async function AdminPage({
  searchParams,
}: {
  searchParams: { start?: string; end?: string };
}) {
  const session = await getSession();
  if (!session) redirect('/login');
  if (session.role !== 'admin') redirect('/convertidos');

  const start = searchParams.start;
  const end = searchParams.end;
  const report = await getAdminReport(start ? `${start}T00:00:00.000Z` : undefined, end ? `${end}T23:59:59.999Z` : undefined);

  const tot = report.reduce(
    (a, c) => ({ conv: a.conv + c.conversaciones, carg: a.carg + c.cargas, red: a.red + c.redirects }),
    { conv: 0, carg: 0, red: 0 },
  );

  const td: React.CSSProperties = { padding: '0.5rem 0.6rem', fontSize: '0.85rem', borderBottom: '1px solid #1c2026' };
  const th: React.CSSProperties = { ...td, color: '#8a93a0', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: 1 };
  const num: React.CSSProperties = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };
  const inp: React.CSSProperties = { padding: '0.4rem 0.6rem', borderRadius: 6, border: '1px solid #2a2f36', background: '#15181d', color: '#e7e9ec' };

  return (
    <>
      <Nav slug={session.slug} role="admin" />
      <main style={{ maxWidth: 980, margin: '0 auto', padding: '0 1rem' }}>
        <h1 style={{ fontSize: '1.3rem' }}>Reportes</h1>

        <form method="get" style={{ display: 'flex', gap: '0.5rem', alignItems: 'end', marginBottom: '1.2rem' }}>
          <div><label style={{ ...th, padding: 0, display: 'block' }}>Desde</label><input style={inp} type="date" name="start" defaultValue={start} /></div>
          <div><label style={{ ...th, padding: 0, display: 'block' }}>Hasta</label><input style={inp} type="date" name="end" defaultValue={end} /></div>
          <button style={{ ...inp, background: '#25d366', color: '#000', fontWeight: 700, cursor: 'pointer', border: 'none' }}>Filtrar</button>
        </form>

        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>Cliente</th>
              <th style={{ ...th, textAlign: 'right' }}>Conversaciones</th>
              <th style={{ ...th, textAlign: 'right' }}>Cargas</th>
              <th style={{ ...th, textAlign: 'right' }}>Redirects</th>
              <th style={{ ...th, textAlign: 'right' }}>% Conv.</th>
            </tr>
          </thead>
          <tbody>
            {report.length === 0 && <tr><td style={{ ...td, color: '#8a93a0' }} colSpan={5}>Sin clientes.</td></tr>}
            {report.map((c) => (
              <tr key={c.tenantId}>
                <td style={td}>{c.name} <span style={{ color: '#8a93a0' }}>· {c.slug}</span></td>
                <td style={num}>{c.conversaciones.toLocaleString()}</td>
                <td style={num}>{c.cargas.toLocaleString()}</td>
                <td style={num}>{c.redirects.toLocaleString()}</td>
                <td style={{ ...num, color: '#25d366' }}>{c.conversion}%</td>
              </tr>
            ))}
          </tbody>
          {report.length > 0 && (
            <tfoot>
              <tr>
                <td style={{ ...td, fontWeight: 700, borderTop: '2px solid #2a2f36' }}>Total</td>
                <td style={{ ...num, fontWeight: 700, borderTop: '2px solid #2a2f36' }}>{tot.conv.toLocaleString()}</td>
                <td style={{ ...num, fontWeight: 700, borderTop: '2px solid #2a2f36' }}>{tot.carg.toLocaleString()}</td>
                <td style={{ ...num, fontWeight: 700, borderTop: '2px solid #2a2f36' }}>{tot.red.toLocaleString()}</td>
                <td style={{ ...num, fontWeight: 700, borderTop: '2px solid #2a2f36' }}>
                  {tot.conv ? +(100 * tot.carg / tot.conv).toFixed(1) : 0}%
                </td>
              </tr>
            </tfoot>
          )}
        </table>

        <p style={{ color: '#8a93a0', fontSize: '0.78rem', marginTop: '1rem' }}>
          Datos desde nuestra base (meta_events). El costo por chat/carga se agrega cuando
          conectemos el gasto de Meta Ads. Sistema independiente del PAYBOT original.
        </p>
      </main>
    </>
  );
}

import { redirect } from 'next/navigation';
import { desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { leads } from '@/db/schema';
import { getSession } from '@/lib/session';
import { Nav } from '../_components/Nav';
import { ConvertButton } from './ConvertButton';

export const dynamic = 'force-dynamic';

export default async function ConvertidosPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  if (session.role === 'admin') redirect('/admin');

  const rows = await db.query.leads.findMany({
    where: eq(leads.tenantId, session.tenantId),
    orderBy: [desc(leads.createdAt)],
    limit: 200,
  });

  return (
    <>
      <Nav slug={session.slug} role={session.role} />
      <main className="shell">
        <div className="page-head">
          <h1>Convertidos</h1>
          <p>Leads recibidos y su estado de conversión.</p>
        </div>

        <div className="card">
          <div className="card__title" style={{ justifyContent: 'space-between' }}>
            <span><span className="ico">✓</span> Leads</span>
            <span className="badge badge--muted">{rows.length}</span>
          </div>
          <table className="table">
            <thead>
              <tr>
                <th>Lead</th>
                <th>Nombre</th>
                <th>Teléfono</th>
                <th>Campaña</th>
                <th>Atribución</th>
                <th>Estado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={7} className="empty">Todavía no hay leads. Llegan por el webhook de Kommo.</td></tr>
              )}
              {rows.map((l) => (
                <tr key={l.id}>
                  <td style={{ color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>{l.kommoLeadId ?? '—'}</td>
                  <td>{l.name ?? '—'}</td>
                  <td style={{ fontVariantNumeric: 'tabular-nums' }}>{l.phone ?? '—'}</td>
                  <td>{l.campaignId ? <span className="badge badge--type">{l.campaignId}</span> : '—'}</td>
                  <td>
                    {l.fbc || l.fbclid ? <span className="badge badge--green">fbc ✓</span> : <span className="badge badge--muted">sin fbc</span>}
                  </td>
                  <td>{l.converted ? <span className="badge badge--green">Convertido</span> : <span className="badge badge--muted">—</span>}</td>
                  <td>
                    {l.kommoLeadId != null && <ConvertButton kommoLeadId={l.kommoLeadId} converted={!!l.converted} />}
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

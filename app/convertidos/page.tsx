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

  const th: React.CSSProperties = {
    textAlign: 'left',
    padding: '0.5rem 0.6rem',
    fontSize: '0.7rem',
    textTransform: 'uppercase',
    letterSpacing: 1,
    color: '#8a93a0',
    borderBottom: '1px solid #2a2f36',
  };
  const td: React.CSSProperties = {
    padding: '0.5rem 0.6rem',
    fontSize: '0.85rem',
    borderBottom: '1px solid #1c2026',
  };

  return (
    <>
    <Nav slug={session.slug} role={session.role} />
    <main style={{ maxWidth: 980, margin: '0 auto 4vh', padding: '0 1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.3rem', margin: 0 }}>
          Convertidos · <span style={{ color: '#25d366' }}>{session.slug}</span>
        </h1>
        <span style={{ fontSize: '0.8rem', color: '#8a93a0' }}>{rows.length} leads</span>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={th}>Lead Kommo</th>
            <th style={th}>Nombre</th>
            <th style={th}>Teléfono</th>
            <th style={th}>Campaña</th>
            <th style={th}>fbc</th>
            <th style={th}>Estado</th>
            <th style={th}></th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td style={{ ...td, color: '#8a93a0' }} colSpan={7}>
                Todavía no hay leads. Llegan por el webhook de Kommo.
              </td>
            </tr>
          )}
          {rows.map((l) => (
            <tr key={l.id}>
              <td style={td}>{l.kommoLeadId ?? '—'}</td>
              <td style={td}>{l.name ?? '—'}</td>
              <td style={td}>{l.phone ?? '—'}</td>
              <td style={td}>{l.campaignId ?? '—'}</td>
              <td style={{ ...td, color: l.fbc ? '#7fd99a' : '#ff6b6b', fontSize: '0.7rem' }}>
                {l.fbc ? 'sí' : 'no'}
              </td>
              <td style={td}>{l.converted ? '✓' : '—'}</td>
              <td style={td}>
                {l.kommoLeadId != null && (
                  <ConvertButton kommoLeadId={l.kommoLeadId} converted={!!l.converted} />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
    </>
  );
}

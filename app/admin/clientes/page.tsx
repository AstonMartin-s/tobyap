import { redirect } from 'next/navigation';
import { desc } from 'drizzle-orm';
import { db } from '@/db';
import { tenants } from '@/db/schema';
import { getSession } from '@/lib/session';
import { Nav } from '../../_components/Nav';

export const dynamic = 'force-dynamic';

// Listado de clientes (tenants). Solo admin. El alta automática es Fase 1+ futura;
// por ahora muestra los clientes cargados.
export default async function ClientesPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  if (session.role !== 'admin') redirect('/convertidos');

  const rows = await db
    .select()
    .from(tenants)
    .orderBy(desc(tenants.createdAt));

  const td: React.CSSProperties = { padding: '0.5rem 0.6rem', fontSize: '0.85rem', borderBottom: '1px solid #1c2026' };
  const th: React.CSSProperties = { ...td, color: '#8a93a0', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: 1 };

  return (
    <>
      <Nav slug={session.slug} role="admin" />
      <main style={{ maxWidth: 980, margin: '0 auto', padding: '0 1rem' }}>
        <h1 style={{ fontSize: '1.3rem' }}>Clientes</h1>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><th style={th}>Slug</th><th style={th}>Nombre</th><th style={th}>Usuario</th><th style={th}>Rol</th><th style={th}>Suffix</th><th style={th}>Activo</th></tr></thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id}>
                <td style={td}>{t.slug}</td>
                <td style={td}>{t.name}</td>
                <td style={td}>{t.panelUser ?? '—'}</td>
                <td style={{ ...td, color: t.role === 'admin' ? '#ffb84d' : '#cfd3d9' }}>{t.role}</td>
                <td style={td}>{t.eventSuffix ?? '—'}</td>
                <td style={td}>{t.active ? '✓' : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </main>
    </>
  );
}

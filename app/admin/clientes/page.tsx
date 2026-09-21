import Link from 'next/link';
import { redirect } from 'next/navigation';
import { desc } from 'drizzle-orm';
import { db } from '@/db';
import { tenants } from '@/db/schema';
import { getSession } from '@/lib/session';
import { decryptOptional } from '@/lib/crypto';
import { Nav } from '../../_components/Nav';
import { CopyPassword } from './CopyPassword';

function copyablePassword(blob: string | null): string | null {
  try {
    return decryptOptional(blob);
  } catch {
    return null;
  }
}

export const dynamic = 'force-dynamic';

export default async function ClientesPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  if (session.role !== 'admin') redirect('/reportes');

  const rows = await db.select().from(tenants).orderBy(desc(tenants.createdAt));

  return (
    <>
      <Nav slug={session.slug} role="admin" />
      <main className="shell">
        <div className="page-head"><div className="page-head__text"><h1>Clientes</h1><p>Cuentas dadas de alta en el sistema.</p></div></div>
        <div className="card">
          <table className="table">
            <thead><tr><th>Slug</th><th>Nombre</th><th>Usuario</th><th>Contraseña</th><th>Rol</th><th>Suffix</th><th>Activo</th><th>Trazabilidad</th></tr></thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id}>
                  <td><Link href={`/admin/clientes/${t.slug}`} style={{ color: 'var(--accent)', fontWeight: 600 }}>{t.slug}</Link></td>
                  <td>{t.name}</td>
                  <td style={{ color: 'var(--muted)' }}>{t.panelUser ?? '—'}</td>
                  <td><CopyPassword value={copyablePassword(t.panelPasswordEnc)} /></td>
                  <td>{t.role === 'admin' ? <span className="badge badge--warn">admin</span> : <span className="badge badge--muted">client</span>}</td>
                  <td>{t.eventSuffix ?? '—'}</td>
                  <td>{t.active ? <span className="badge badge--green">activo</span> : <span className="badge badge--muted">—</span>}</td>
                  <td><Link href={`/admin/trazabilidad?tenant=${t.slug}`} style={{ color: 'var(--accent)' }}>ver →</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </>
  );
}

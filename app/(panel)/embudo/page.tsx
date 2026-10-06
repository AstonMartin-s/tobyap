import { redirect } from 'next/navigation';
import { getSession, canAccess } from '@/lib/session';
import { getTenantBySlug } from '@/lib/tenants';
import { EmbudoClient } from './EmbudoClient';

export const dynamic = 'force-dynamic';

export default async function EmbudoPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  if (session.role === 'admin') redirect('/admin');
  if (!canAccess(session.panelRole, 'embudo')) redirect('/chats');
  const tenant = await getTenantBySlug(session.slug);
  if (tenant && !tenant.features.embudo) redirect('/chats');

  return (
    <main className="shell shell--wide" style={{ paddingTop: '1.2rem' }}>
      <div className="page-head" style={{ marginBottom: '1rem' }}>
        <div className="page-head__text">
          <h1>Embudo</h1>
          <p>Mapa de las etapas para organizar la gestión. Los totales salen de la base completa.</p>
        </div>
      </div>
      <EmbudoClient />
    </main>
  );
}

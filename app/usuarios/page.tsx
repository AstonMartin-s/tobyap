import { redirect } from 'next/navigation';
import { getSession, canAccess } from '@/lib/session';
import { Nav } from '../_components/Nav';
import { UsuariosClient } from './UsuariosClient';

export const dynamic = 'force-dynamic';

export default async function UsuariosPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  if (session.role === 'admin') redirect('/admin');
  if (!canAccess(session.panelRole, 'usuarios')) redirect('/chats');

  return (
    <>
      <Nav slug={session.slug} role={session.role} panelRole={session.panelRole} />
      <main className="shell">
        <UsuariosClient currentUserId={session.userId ?? ''} />
      </main>
    </>
  );
}

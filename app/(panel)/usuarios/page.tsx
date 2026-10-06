import { redirect } from 'next/navigation';
import { getSession, canAccess } from '@/lib/session';
import { UsuariosClient } from './UsuariosClient';

export const dynamic = 'force-dynamic';

export default async function UsuariosPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  if (session.role === 'admin') redirect('/admin');
  if (!canAccess(session.panelRole, 'usuarios')) redirect('/chats');

  return (
    <main className="shell">
      <UsuariosClient currentUserId={session.userId ?? ''} />
    </main>
  );
}

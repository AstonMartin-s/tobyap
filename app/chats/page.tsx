import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { Nav } from '../_components/Nav';
import { ChatsClient } from './ChatsClient';

export const dynamic = 'force-dynamic';

export default async function ChatsPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  if (session.role === 'admin') redirect('/admin');

  return (
    <>
      <Nav slug={session.slug} role={session.role} />
      <main className="shell shell--wide">
        <div className="page-head" style={{ marginBottom: '.9rem' }}>
          <div className="page-head__text">
            <h1>Chats web</h1>
            <p>Gestioná las conversaciones en curso y ejecutá acciones manuales.</p>
          </div>
        </div>
        <ChatsClient />
      </main>
    </>
  );
}

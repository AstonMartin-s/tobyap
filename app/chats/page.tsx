import { redirect } from 'next/navigation';
import { getSession, isPanelAdmin } from '@/lib/session';
import { Nav } from '../_components/Nav';
import { ChatsClient } from './ChatsClient';

export const dynamic = 'force-dynamic';

export default async function ChatsPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  if (session.role === 'admin') redirect('/admin');

  return (
    <>
      <Nav slug={session.slug} role={session.role} panelRole={session.panelRole} />
      <main className="shell shell--wide" style={{ paddingTop: '.8rem' }}>
        <ChatsClient canExport={isPanelAdmin(session.panelRole)} />
      </main>
    </>
  );
}

import { redirect } from 'next/navigation';
import { getSession, canAccess } from '@/lib/session';
import { ConfigClient } from './ConfigClient';

export const dynamic = 'force-dynamic';

export default async function ConfigPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  if (session.role === 'admin') redirect('/admin');
  if (!canAccess(session.panelRole, 'config')) redirect('/chats');

  return (
    <main className="shell">
      <ConfigClient />
    </main>
  );
}

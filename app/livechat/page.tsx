import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { Nav } from '../_components/Nav';
import { LivechatClient } from './LivechatClient';

export const dynamic = 'force-dynamic';

export default async function LivechatPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  if (session.role === 'admin') redirect('/admin');

  return (
    <>
      <Nav slug={session.slug} role={session.role} />
      <main className="shell" style={{ paddingTop: '1.2rem' }}>
        <LivechatClient />
      </main>
    </>
  );
}

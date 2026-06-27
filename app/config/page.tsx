import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { Nav } from '../_components/Nav';
import { ConfigClient } from './ConfigClient';

export const dynamic = 'force-dynamic';

export default async function ConfigPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  if (session.role === 'admin') redirect('/admin');

  return (
    <>
      <Nav slug={session.slug} role={session.role} />
      <main style={{ maxWidth: 880, margin: '0 auto 6vh', padding: '0 1rem' }}>
        <ConfigClient />
      </main>
    </>
  );
}

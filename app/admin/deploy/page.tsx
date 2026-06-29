import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { Nav } from '../../_components/Nav';
import { DeployClient } from './DeployClient';

export const dynamic = 'force-dynamic';

export default async function DeployPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  if (session.role !== 'admin') redirect('/reportes');
  return (
    <>
      <Nav slug={session.slug} role="admin" />
      <main className="shell">
        <DeployClient />
      </main>
    </>
  );
}

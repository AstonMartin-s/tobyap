import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { Nav } from '../../../_components/Nav';
import { ManageClient } from './ManageClient';

export const dynamic = 'force-dynamic';

export default async function ClienteDetail({ params }: { params: { slug: string } }) {
  const session = await getSession();
  if (!session) redirect('/login');
  if (session.role !== 'admin') redirect('/reportes');
  return (
    <>
      <Nav slug={session.slug} role="admin" />
      <main className="shell">
        <ManageClient slug={params.slug} />
      </main>
    </>
  );
}

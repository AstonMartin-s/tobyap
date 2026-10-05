import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { getTenantBySlug } from '@/lib/tenants';
import { hasWhatsappChannel } from '@/lib/blaster';
import { Nav } from '../_components/Nav';
import { WaConnectClient } from './WaConnectClient';

export const dynamic = 'force-dynamic';

export default async function WaConnectPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  if (session.role === 'admin') redirect('/admin');

  const tenant = await getTenantBySlug(session.slug);
  if (!tenant || !hasWhatsappChannel(tenant)) redirect('/chats');

  return (
    <>
      <Nav slug={session.slug} role={session.role} panelRole={session.panelRole} />
      <main className="shell" style={{ paddingTop: '.8rem' }}>
        <WaConnectClient />
      </main>
    </>
  );
}

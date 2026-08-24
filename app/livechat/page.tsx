import { redirect } from 'next/navigation';
import { getSession, canAccess } from '@/lib/session';
import { getTenantBySlug } from '@/lib/tenants';
import { Nav } from '../_components/Nav';
import { LivechatClient } from './LivechatClient';

export const dynamic = 'force-dynamic';

export default async function LivechatPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  if (session.role === 'admin') redirect('/admin');
  if (!canAccess(session.panelRole, 'livechat')) redirect('/chats');
  const tenant = await getTenantBySlug(session.slug);
  if (tenant && !tenant.features.livechat) redirect('/chats');

  return (
    <>
      <Nav slug={session.slug} role={session.role} panelRole={session.panelRole} />
      <main className="shell shell--wide" style={{ paddingTop: '1.2rem' }}>
        <LivechatClient
          slug={session.slug}
          landingOrigin={process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : ''}
        />
      </main>
    </>
  );
}

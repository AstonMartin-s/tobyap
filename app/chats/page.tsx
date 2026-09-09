import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getSession, isPanelAdmin } from '@/lib/session';
import { Nav } from '../_components/Nav';
import { ChatsClient } from './ChatsClient';

export const dynamic = 'force-dynamic';

// PWA del panel (solo útil para tenants manual: goldenC / ElGanador). En iPhone
// el push de fondo EXIGE que el panel esté instalado en inicio.
export const metadata: Metadata = {
  manifest: '/panel-manifest.json',
  appleWebApp: { capable: true, title: 'TrackerIO · Panel', statusBarStyle: 'black-translucent' },
};

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

import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { getTenantBySlug } from '@/lib/tenants';
import { hasWhatsappChannel } from '@/lib/blaster';
import { Nav } from '../_components/Nav';

export const dynamic = 'force-dynamic';

// El menú vive acá (no en cada page) para que no se desmonte al cambiar
// de Reportes/Chats/WhatsApp/Embudo. Si está en la page, WhatsApp arranca
// oculto y la lista salta.
export default async function PanelLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/login');
  if (session.role === 'admin') return <>{children}</>;

  const tenant = await getTenantBySlug(session.slug);
  return (
    <>
      <Nav
        slug={session.slug}
        role={session.role}
        panelRole={session.panelRole}
        whatsapp={tenant ? hasWhatsappChannel(tenant) : false}
        features={tenant?.features}
        niche={tenant?.niche === 'tienda' ? 'tienda' : 'circo'}
      />
      {children}
    </>
  );
}

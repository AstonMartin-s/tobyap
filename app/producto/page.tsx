import { redirect } from 'next/navigation';
import { getSession, canAccess } from '@/lib/session';
import { getTenantBySlug } from '@/lib/tenants';
import { Nav } from '../_components/Nav';
import { ProductoClient } from './ProductoClient';

export const dynamic = 'force-dynamic';

// Onboarding / matriz del nicho TIENDA: el cliente define su proceso de venta
// (productos, pago, entrega, marca). Solo para tenants niche='tienda'.
export default async function ProductoPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  if (session.role === 'admin') redirect('/admin');
  if (!canAccess(session.panelRole, 'producto')) redirect('/chats');
  const tenant = await getTenantBySlug(session.slug);
  if (!tenant || tenant.niche !== 'tienda') redirect('/chats');

  return (
    <>
      <Nav slug={session.slug} role={session.role} panelRole={session.panelRole} />
      <main className="shell shell--wide" style={{ paddingTop: '1.2rem' }}>
        <ProductoClient />
      </main>
    </>
  );
}

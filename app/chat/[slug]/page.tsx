import type { Metadata, Viewport } from 'next';
import ChatWidget from './ChatWidget';
import { getTenantBySlug } from '@/lib/tenants';
import { loadChatBrand } from '@/lib/chat/loadBrand';
import { DEFAULT_HEADER } from '@/lib/chat/brand';

export const dynamic = 'force-dynamic';

export const viewport: Viewport = {
  themeColor: DEFAULT_HEADER,
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const tenant = await getTenantBySlug(params.slug);
  const brand = tenant
    ? await loadChatBrand(tenant.id, tenant.slug, tenant.name)
    : { brandName: 'Soporte', primaryColor: DEFAULT_HEADER, avatarUrl: null };
  return {
    title: `${brand.brandName} — Soporte`,
    manifest: `/api/chat/${params.slug}/manifest`,
    appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: brand.brandName },
    icons: { apple: '/chat-apple-180.png', icon: '/chat-icon-192.png' },
  };
}

export default async function ChatPage({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams: { token?: string; campaign?: string; ccpp?: string; brand?: string };
}) {
  const tenant = await getTenantBySlug(params.slug);
  const cfg = tenant ? await loadChatBrand(tenant.id, tenant.slug, tenant.name) : { brandName: 'Soporte', primaryColor: DEFAULT_HEADER, avatarUrl: null };
  const brand = cfg.brandName;
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: "window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.__bipEvent=e;});" }} />
      <ChatWidget
        slug={params.slug}
        token={searchParams.token ?? ''}
        campaign={searchParams.campaign ?? ''}
        ccpp={searchParams.ccpp ?? ''}
        brand={brand}
        primaryColor={cfg.primaryColor}
        avatarUrl={cfg.avatarUrl}
      />
    </>
  );
}

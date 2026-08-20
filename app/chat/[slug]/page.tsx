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
      <script dangerouslySetInnerHTML={{ __html: "window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.__bipEvent=e;});(function(){function isChunkErr(m){return /ChunkLoadError|Loading chunk|Importing a module script failed|error loading dynamically imported module/i.test(String(m||''));}function recover(){try{if(sessionStorage.getItem('cr'))return;sessionStorage.setItem('cr','1');}catch(_){}if('serviceWorker'in navigator){navigator.serviceWorker.getRegistrations().then(function(rs){rs.forEach(function(r){r.unregister();});}).catch(function(){});}if(window.caches&&caches.keys){caches.keys().then(function(ks){ks.forEach(function(k){caches.delete(k);});}).catch(function(){});}setTimeout(function(){location.reload();},60);}window.addEventListener('error',function(e){if(isChunkErr(e&&e.message)||isChunkErr(e&&e.error&&e.error.message))recover();});window.addEventListener('unhandledrejection',function(e){var r=e&&e.reason;if(isChunkErr(r&&r.message)||isChunkErr(r))recover();});})();" }} />
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

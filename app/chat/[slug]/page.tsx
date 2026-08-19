import type { Metadata, Viewport } from 'next';
import ChatWidget from './ChatWidget';

export const dynamic = 'force-dynamic';

export const viewport: Viewport = {
  themeColor: '#008069',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const brand = 'King';
  return {
    title: `${brand} — Soporte`,
    manifest: `/api/chat/${params.slug}/manifest`,
    appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: brand },
    icons: { apple: '/chat-apple-180.png', icon: '/chat-icon-192.png' },
  };
}

export default function ChatPage({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams: { token?: string; campaign?: string; ccpp?: string; brand?: string };
}) {
  return (
    <>
      {/* Captura el instalador PWA aunque dispare antes de montar el widget. */}
      <script dangerouslySetInnerHTML={{ __html: "window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.__bipEvent=e;});" }} />
      <ChatWidget
        slug={params.slug}
        token={searchParams.token ?? ''}
        campaign={searchParams.campaign ?? ''}
        ccpp={searchParams.ccpp ?? ''}
        brand={searchParams.brand || 'King'}
      />
    </>
  );
}

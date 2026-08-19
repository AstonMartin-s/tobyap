import { NextRequest, NextResponse } from 'next/server';
import { getTenantBySlug } from '@/lib/tenants';
import { loadChatBrand } from '@/lib/chat/loadBrand';
import { DEFAULT_HEADER } from '@/lib/chat/brand';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { slug: string } }) {
  const tenant = await getTenantBySlug(params.slug);
  const brand = tenant ? await loadChatBrand(tenant.id, tenant.slug, tenant.name) : { brandName: 'Soporte', primaryColor: DEFAULT_HEADER, avatarUrl: null };
  const manifest = {
    name: `${brand.brandName} — Soporte`,
    short_name: brand.brandName,
    description: 'Tu acceso directo a bonificaciones y soporte 24hs.',
    start_url: `/chat/${params.slug}`,
    scope: `/chat/${params.slug}`,
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#ECE5DD',
    theme_color: brand.primaryColor || DEFAULT_HEADER,
    icons: [
      { src: '/chat-icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
      { src: '/chat-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
    ],
  };
  return NextResponse.json(manifest, { headers: { 'Content-Type': 'application/manifest+json' } });
}

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// GET /api/chat/[slug]/manifest — Web App Manifest para instalar el chat como app.
export async function GET(_req: NextRequest, { params }: { params: { slug: string } }) {
  const brand = 'King';
  const manifest = {
    name: `${brand} — Soporte`,
    short_name: brand,
    description: 'Tu acceso directo a bonificaciones y soporte 24hs.',
    start_url: `/chat/${params.slug}`,
    scope: `/chat/${params.slug}`,
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#ECE5DD',
    theme_color: '#008069',
    icons: [
      { src: '/chat-icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
      { src: '/chat-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
    ],
  };
  return NextResponse.json(manifest, { headers: { 'Content-Type': 'application/manifest+json' } });
}

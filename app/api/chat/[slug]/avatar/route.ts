import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { clientSettings } from '@/db/schema';
import { getTenantBySlug } from '@/lib/tenants';
import { readComprobante } from '@/lib/storage';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { slug: string } }) {
  const tenant = await getTenantBySlug(params.slug);
  if (!tenant) return NextResponse.json({ error: 'tenant desconocido' }, { status: 404 });
  const [row] = await db.select({ chatConfig: clientSettings.chatConfig }).from(clientSettings).where(eq(clientSettings.tenantId, tenant.id)).limit(1);
  const path = (row?.chatConfig as Record<string, unknown> | null)?.avatarPath;
  if (typeof path !== 'string' || !path) return NextResponse.json({ error: 'sin avatar' }, { status: 404 });
  const buf = await readComprobante(path);
  if (!buf) return NextResponse.json({ error: 'sin archivo' }, { status: 404 });
  const mime = path.endsWith('.png') ? 'image/png' : path.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
  return new NextResponse(new Uint8Array(buf), { headers: { 'Content-Type': mime, 'Cache-Control': 'public, max-age=3600' } });
}

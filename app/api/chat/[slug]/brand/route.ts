import { NextRequest, NextResponse } from 'next/server';
import { getTenantBySlug } from '@/lib/tenants';
import { loadChatBrand } from '@/lib/chat/loadBrand';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { slug: string } }) {
  const tenant = await getTenantBySlug(params.slug);
  if (!tenant) return NextResponse.json({ error: 'tenant desconocido' }, { status: 404 });
  const brand = await loadChatBrand(tenant.id, tenant.slug, tenant.name);
  return NextResponse.json({ ok: true, brand }, { headers: { 'Cache-Control': 'no-store' } });
}

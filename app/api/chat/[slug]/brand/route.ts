import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { clientSettings } from '@/db/schema';
import { getTenantBySlug } from '@/lib/tenants';
import { loadChatBrand } from '@/lib/chat/loadBrand';
import { walinkSupportUrl } from '@/lib/chat/runtime';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { slug: string } }) {
  const tenant = await getTenantBySlug(params.slug);
  if (!tenant) return NextResponse.json({ error: 'tenant desconocido' }, { status: 404 });
  const brand = await loadChatBrand(tenant.id, tenant.slug, tenant.name);

  let waBtn: { enabled: boolean; url: string } = { enabled: true, url: walinkSupportUrl(tenant.slug) };
  try {
    const [row] = await db.select({ chatConfig: clientSettings.chatConfig }).from(clientSettings).where(eq(clientSettings.tenantId, tenant.id)).limit(1);
    const cc = row?.chatConfig as Record<string, unknown> | null;
    if (cc) {
      if (cc.waBtnEnabled === false) waBtn.enabled = false;
      if (typeof cc.waBtnUrl === 'string' && cc.waBtnUrl.trim()) waBtn.url = cc.waBtnUrl.trim();
      else if (typeof cc.landingDomain === 'string') waBtn.url = walinkSupportUrl(tenant.slug, cc.landingDomain as string);
    }
  } catch { /* defaults */ }

  return NextResponse.json({ ok: true, brand, waBtn, niche: tenant.niche }, { headers: { 'Cache-Control': 'no-store' } });
}

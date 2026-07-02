import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { tenants, clientSettings, numbers, landings } from '@/db/schema';
import { isAdmin } from '@/lib/admin-auth';
import { updateTenantFields, type UpdateTenantPatch } from '@/lib/tenants';

// GET /api/admin/tenant/[slug] — info NO secreta del cliente para el detalle admin.
export async function GET(req: NextRequest, { params }: { params: { slug: string } }) {
  if (!(await isAdmin(req))) return NextResponse.json({ error: 'no autorizado' }, { status: 401 });

  const t = await db.query.tenants.findFirst({ where: eq(tenants.slug, params.slug) });
  if (!t) return NextResponse.json({ error: 'no encontrado' }, { status: 404 });

  const [s] = await db.select().from(clientSettings).where(eq(clientSettings.tenantId, t.id));
  const nums = await db.select().from(numbers).where(eq(numbers.tenantId, t.id));
  const lps = await db.select().from(landings).where(eq(landings.tenantId, t.id));

  return NextResponse.json({
    tenant: {
      id: t.id,
      slug: t.slug,
      name: t.name,
      panelUser: t.panelUser,
      eventSuffix: t.eventSuffix,
      readonly: t.readonly,
      allowTags: t.allowTags,
      active: t.active,
      role: t.role,
      kommoSubdomain: t.kommoSubdomain,
      kommoPipelineId: t.kommoPipelineId,
      metaPixelId: t.metaPixelId,
      hasMetaToken: !!t.metaCapiToken,
      hasKommoToken: !!t.kommoToken,
      customFields: t.customFields ?? {},
    },
    settings: s ? { accountName: s.accountName, accountCbu: s.accountCbu, message: s.message } : null,
    numbers: nums.map((n) => ({ id: n.id, name: n.name, phone: n.phone, type: n.type, status: n.status })),
    landings: lps,
  });
}

// PATCH /api/admin/tenant/[slug] — edición parcial (no pisa secretos vacíos).
export async function PATCH(req: NextRequest, { params }: { params: { slug: string } }) {
  if (!(await isAdmin(req))) return NextResponse.json({ error: 'no autorizado' }, { status: 401 });
  const patch = (await req.json().catch(() => ({}))) as UpdateTenantPatch;
  await updateTenantFields(params.slug, patch);
  return NextResponse.json({ ok: true });
}

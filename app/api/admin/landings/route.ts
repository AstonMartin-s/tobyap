import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { tenants, landings } from '@/db/schema';
import { isAdmin } from '@/lib/admin-auth';

// GET /api/admin/landings?tenant=<slug> — landings de un cliente.
export async function GET(req: NextRequest) {
  if (!(await isAdmin(req))) return NextResponse.json({ error: 'no autorizado' }, { status: 401 });
  const slug = req.nextUrl.searchParams.get('tenant');
  if (!slug) return NextResponse.json({ error: 'tenant requerido' }, { status: 400 });
  const t = await db.query.tenants.findFirst({ where: eq(tenants.slug, slug) });
  if (!t) return NextResponse.json({ error: 'tenant no encontrado' }, { status: 404 });
  const rows = await db.select().from(landings).where(eq(landings.tenantId, t.id));
  return NextResponse.json({ landings: rows });
}

// POST /api/admin/landings — crea una landing para un cliente.
// Body: { tenant: slug, landingSlug, name, type, config }
export async function POST(req: NextRequest) {
  if (!(await isAdmin(req))) return NextResponse.json({ error: 'no autorizado' }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as {
    tenant?: string;
    landingSlug?: string;
    name?: string;
    type?: string;
    config?: Record<string, string | number | null>;
  };
  if (!b.tenant || !b.landingSlug) {
    return NextResponse.json({ error: 'tenant y landingSlug requeridos' }, { status: 400 });
  }
  const t = await db.query.tenants.findFirst({ where: eq(tenants.slug, b.tenant) });
  if (!t) return NextResponse.json({ error: 'tenant no encontrado' }, { status: 404 });

  const slug = b.landingSlug.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
  try {
    const [row] = await db
      .insert(landings)
      .values({
        tenantId: t.id,
        landingSlug: slug,
        name: b.name ?? slug,
        type: b.type ?? 'publi',
        config: b.config ?? {},
        active: true,
      })
      .returning();
    return NextResponse.json({ ok: true, landing: row, publicPath: `/l/${t.slug}/${slug}` });
  } catch {
    return NextResponse.json({ error: 'ya existe una landing con ese slug' }, { status: 409 });
  }
}

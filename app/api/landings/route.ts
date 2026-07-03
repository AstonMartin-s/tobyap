import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { landings, tenants } from '@/db/schema';
import { getSession } from '@/lib/session';

// GET /api/landings — landings del cliente logueado + su slug (para armar URLs).
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no autenticado' }, { status: 401 });

  const rows = await db
    .select()
    .from(landings)
    .where(eq(landings.tenantId, session.tenantId))
    .orderBy(desc(landings.createdAt));

  const [t] = await db.select({ slug: tenants.slug }).from(tenants).where(eq(tenants.id, session.tenantId));
  return NextResponse.json({ slug: t?.slug ?? session.slug, landings: rows });
}

// POST /api/landings — crea una landing del cliente.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no autenticado' }, { status: 401 });

  const b = (await req.json().catch(() => ({}))) as {
    landingSlug?: string;
    name?: string;
    type?: string;
    config?: Record<string, string | number | null>;
  };
  if (!b.landingSlug) return NextResponse.json({ error: 'landingSlug requerido' }, { status: 400 });

  const slug = b.landingSlug.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
  try {
    const [row] = await db
      .insert(landings)
      .values({
        tenantId: session.tenantId,
        landingSlug: slug,
        name: b.name ?? slug,
        type: b.type ?? 'publi',
        config: b.config ?? {},
        active: true,
      })
      .returning();
    return NextResponse.json({ ok: true, landing: row });
  } catch {
    return NextResponse.json({ error: 'ya existe una landing con ese slug' }, { status: 409 });
  }
}

// PATCH /api/landings — editar { id, name?, type?, active?, config? }.
export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no autenticado' }, { status: 401 });

  const b = (await req.json().catch(() => ({}))) as {
    id?: string;
    name?: string;
    type?: string;
    active?: boolean;
    config?: Record<string, string | number | null>;
  };
  if (!b.id) return NextResponse.json({ error: 'id requerido' }, { status: 400 });

  const set: Record<string, unknown> = { updatedAt: new Date() };
  for (const f of ['name', 'type', 'active', 'config'] as const) if (f in b) set[f] = b[f];

  const [row] = await db
    .update(landings)
    .set(set)
    .where(and(eq(landings.id, b.id), eq(landings.tenantId, session.tenantId)))
    .returning();
  if (!row) return NextResponse.json({ error: 'no encontrada' }, { status: 404 });
  return NextResponse.json({ ok: true, landing: row });
}

// DELETE /api/landings?id=...
export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no autenticado' }, { status: 401 });

  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 });
  await db.delete(landings).where(and(eq(landings.id, id), eq(landings.tenantId, session.tenantId)));
  return NextResponse.json({ ok: true });
}

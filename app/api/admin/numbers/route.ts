import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { numbers, tenants } from '@/db/schema';
import { isAdmin } from '@/lib/admin-auth';

// Categorías = tipos de landing (para que la landing rote entre números de su
// misma categoría).
const TYPES = ['publi', 'regular', 'spam', 'remarketing', 'soporte'];

async function tenantId(slug: string): Promise<string | null> {
  const t = await db.query.tenants.findFirst({ where: eq(tenants.slug, slug) });
  return t?.id ?? null;
}

// GET /api/admin/numbers?tenant=<slug>
export async function GET(req: NextRequest) {
  if (!(await isAdmin(req))) return NextResponse.json({ error: 'no autorizado' }, { status: 401 });
  const slug = req.nextUrl.searchParams.get('tenant');
  if (!slug) return NextResponse.json({ error: 'tenant requerido' }, { status: 400 });
  const tid = await tenantId(slug);
  if (!tid) return NextResponse.json({ error: 'tenant no encontrado' }, { status: 404 });
  const rows = await db.select().from(numbers).where(eq(numbers.tenantId, tid)).orderBy(desc(numbers.createdAt));
  return NextResponse.json({ numbers: rows });
}

// POST /api/admin/numbers  { tenant, name, phone, type, status? }
export async function POST(req: NextRequest) {
  if (!(await isAdmin(req))) return NextResponse.json({ error: 'no autorizado' }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  if (!b.tenant) return NextResponse.json({ error: 'tenant requerido' }, { status: 400 });
  if (b.type && !TYPES.includes(b.type)) return NextResponse.json({ error: `type inválido (${TYPES.join('|')})` }, { status: 400 });
  const tid = await tenantId(b.tenant);
  if (!tid) return NextResponse.json({ error: 'tenant no encontrado' }, { status: 404 });
  const [row] = await db
    .insert(numbers)
    .values({ tenantId: tid, name: b.name ?? null, phone: b.phone ?? null, status: b.status ?? true, type: b.type ?? null })
    .returning();
  return NextResponse.json({ ok: true, number: row });
}

// PATCH /api/admin/numbers  { tenant, id, ...campos }
export async function PATCH(req: NextRequest) {
  if (!(await isAdmin(req))) return NextResponse.json({ error: 'no autorizado' }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  if (!b.tenant || !b.id) return NextResponse.json({ error: 'tenant e id requeridos' }, { status: 400 });
  if (b.type && !TYPES.includes(b.type)) return NextResponse.json({ error: `type inválido (${TYPES.join('|')})` }, { status: 400 });
  const tid = await tenantId(b.tenant);
  if (!tid) return NextResponse.json({ error: 'tenant no encontrado' }, { status: 404 });
  const set: Record<string, unknown> = {};
  for (const f of ['name', 'phone', 'status', 'type']) if (f in b) set[f] = b[f];
  const [row] = await db.update(numbers).set(set).where(and(eq(numbers.id, b.id), eq(numbers.tenantId, tid))).returning();
  if (!row) return NextResponse.json({ error: 'no encontrado' }, { status: 404 });
  return NextResponse.json({ ok: true, number: row });
}

// DELETE /api/admin/numbers?tenant=<slug>&id=<id>
export async function DELETE(req: NextRequest) {
  if (!(await isAdmin(req))) return NextResponse.json({ error: 'no autorizado' }, { status: 401 });
  const slug = req.nextUrl.searchParams.get('tenant');
  const id = req.nextUrl.searchParams.get('id');
  if (!slug || !id) return NextResponse.json({ error: 'tenant e id requeridos' }, { status: 400 });
  const tid = await tenantId(slug);
  if (!tid) return NextResponse.json({ error: 'tenant no encontrado' }, { status: 404 });
  await db.delete(numbers).where(and(eq(numbers.id, id), eq(numbers.tenantId, tid)));
  return NextResponse.json({ ok: true });
}

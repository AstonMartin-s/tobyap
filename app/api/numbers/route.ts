import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { numbers } from '@/db/schema';
import { getSession } from '@/lib/session';

const TYPES = ['publi', 'regular', 'spam', 'soporte'];

// GET /api/numbers — números de contacto del tenant (§6.2).
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no autenticado' }, { status: 401 });

  const rows = await db
    .select()
    .from(numbers)
    .where(eq(numbers.tenantId, session.tenantId))
    .orderBy(desc(numbers.createdAt));

  return NextResponse.json({ numbers: rows });
}

// POST /api/numbers — alta de un número.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no autenticado' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  if (body.type && !TYPES.includes(body.type)) {
    return NextResponse.json({ error: `type inválido (${TYPES.join('|')})` }, { status: 400 });
  }

  const [row] = await db
    .insert(numbers)
    .values({
      tenantId: session.tenantId,
      name: body.name ?? null,
      phone: body.phone ?? null,
      status: body.status ?? true,
      type: body.type ?? null,
    })
    .returning();

  return NextResponse.json({ ok: true, number: row });
}

// PATCH /api/numbers — editar { id, ...campos }.
export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no autenticado' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  if (!body.id) return NextResponse.json({ error: 'id requerido' }, { status: 400 });
  if (body.type && !TYPES.includes(body.type)) {
    return NextResponse.json({ error: `type inválido (${TYPES.join('|')})` }, { status: 400 });
  }

  const set: Record<string, unknown> = {};
  for (const f of ['name', 'phone', 'status', 'type']) if (f in body) set[f] = body[f];

  const [row] = await db
    .update(numbers)
    .set(set)
    .where(and(eq(numbers.id, body.id), eq(numbers.tenantId, session.tenantId)))
    .returning();

  if (!row) return NextResponse.json({ error: 'no encontrado' }, { status: 404 });
  return NextResponse.json({ ok: true, number: row });
}

// DELETE /api/numbers?id=...
export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no autenticado' }, { status: 401 });

  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 });

  await db.delete(numbers).where(and(eq(numbers.id, id), eq(numbers.tenantId, session.tenantId)));
  return NextResponse.json({ ok: true });
}

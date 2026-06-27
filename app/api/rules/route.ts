import { NextRequest, NextResponse } from 'next/server';
import { and, asc, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { rules } from '@/db/schema';
import { getSession } from '@/lib/session';

// GET /api/rules?limit=&offset= — reglas del clasificador (§6.4), paginado.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no autenticado' }, { status: 401 });

  const limit = Math.min(Number(req.nextUrl.searchParams.get('limit')) || 50, 200);
  const offset = Number(req.nextUrl.searchParams.get('offset')) || 0;

  const where = eq(rules.tenantId, session.tenantId);
  const rows = await db
    .select()
    .from(rules)
    .where(where)
    .orderBy(asc(rules.priority), asc(rules.createdAt))
    .limit(limit)
    .offset(offset);

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(rules)
    .where(where);

  return NextResponse.json({ rules: rows, total: count, limit, offset, hasMore: offset + rows.length < count });
}

// POST /api/rules — alta de regla.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no autenticado' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const [row] = await db
    .insert(rules)
    .values({
      tenantId: session.tenantId,
      rule: body.rule ?? null,
      text: body.text ?? null,
      crm: body.crm ?? 'kommo',
      pipeline: body.pipeline ?? 'sales',
      priority: body.priority ?? 1,
      status: body.status ?? 'active',
    })
    .returning();

  return NextResponse.json({ ok: true, rule: row });
}

// PATCH /api/rules — editar { id, ...campos }.
export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no autenticado' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  if (!body.id) return NextResponse.json({ error: 'id requerido' }, { status: 400 });

  const set: Record<string, unknown> = { updatedAt: new Date() };
  for (const f of ['rule', 'text', 'crm', 'pipeline', 'priority', 'status']) if (f in body) set[f] = body[f];

  const [row] = await db
    .update(rules)
    .set(set)
    .where(and(eq(rules.id, body.id), eq(rules.tenantId, session.tenantId)))
    .returning();

  if (!row) return NextResponse.json({ error: 'no encontrado' }, { status: 404 });
  return NextResponse.json({ ok: true, rule: row });
}

// DELETE /api/rules?id=...
export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no autenticado' }, { status: 401 });

  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 });

  await db.delete(rules).where(and(eq(rules.id, id), eq(rules.tenantId, session.tenantId)));
  return NextResponse.json({ ok: true });
}

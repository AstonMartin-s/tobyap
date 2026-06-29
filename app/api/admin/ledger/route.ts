import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { tenants, ledger } from '@/db/schema';
import { isAdmin } from '@/lib/admin-auth';

// POST /api/admin/ledger
// Body: { tenant: slug, day: 'YYYY-MM-DD', gasto?, ingreso?, note? }
// Upsert FIJO por (tenant, día): setea el valor (no suma). Editable reenviando.
export async function POST(req: NextRequest) {
  if (!(await isAdmin(req))) return NextResponse.json({ error: 'no autorizado' }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as {
    tenant?: string; day?: string; gasto?: number; ingreso?: number; note?: string;
  };
  if (!b.tenant || !b.day) return NextResponse.json({ error: 'tenant y day requeridos' }, { status: 400 });

  const t = await db.query.tenants.findFirst({ where: eq(tenants.slug, b.tenant) });
  if (!t) return NextResponse.json({ error: 'tenant no encontrado' }, { status: 404 });

  const values = {
    tenantId: t.id,
    day: b.day,
    gasto: Number(b.gasto ?? 0),
    ingreso: Number(b.ingreso ?? 0),
    note: b.note ?? null,
    updatedAt: new Date(),
  };
  const [row] = await db
    .insert(ledger)
    .values(values)
    .onConflictDoUpdate({ target: [ledger.tenantId, ledger.day], set: { gasto: values.gasto, ingreso: values.ingreso, note: values.note, updatedAt: new Date() } })
    .returning();
  return NextResponse.json({ ok: true, entry: row });
}

// DELETE /api/admin/ledger?tenant=<slug>&day=YYYY-MM-DD
export async function DELETE(req: NextRequest) {
  if (!(await isAdmin(req))) return NextResponse.json({ error: 'no autorizado' }, { status: 401 });
  const slug = req.nextUrl.searchParams.get('tenant');
  const day = req.nextUrl.searchParams.get('day');
  if (!slug || !day) return NextResponse.json({ error: 'tenant y day requeridos' }, { status: 400 });
  const t = await db.query.tenants.findFirst({ where: eq(tenants.slug, slug) });
  if (!t) return NextResponse.json({ error: 'tenant no encontrado' }, { status: 404 });
  await db.delete(ledger).where(and(eq(ledger.tenantId, t.id), eq(ledger.day, day)));
  return NextResponse.json({ ok: true });
}

import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { landings } from '@/db/schema';
import { isAdmin } from '@/lib/admin-auth';

// PATCH /api/admin/landings/[id] — actualiza name/type/active/config.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  if (!(await isAdmin(req))) return NextResponse.json({ error: 'no autorizado' }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as {
    name?: string;
    type?: string;
    active?: boolean;
    config?: Record<string, string | number | null>;
  };
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (b.name !== undefined) set.name = b.name;
  if (b.type !== undefined) set.type = b.type;
  if (b.active !== undefined) set.active = b.active;
  if (b.config !== undefined) set.config = b.config;
  await db.update(landings).set(set).where(eq(landings.id, params.id));
  return NextResponse.json({ ok: true });
}

// DELETE /api/admin/landings/[id]
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  if (!(await isAdmin(req))) return NextResponse.json({ error: 'no autorizado' }, { status: 401 });
  await db.delete(landings).where(eq(landings.id, params.id));
  return NextResponse.json({ ok: true });
}

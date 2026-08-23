import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { eq, and } from 'drizzle-orm';
import { db } from '@/db';
import { panelUsers } from '@/db/schema';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

function forbidden() {
  return NextResponse.json({ error: 'sin permisos' }, { status: 403 });
}

// GET — list all panel users for this tenant
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no autenticado' }, { status: 401 });
  if (session.panelRole && session.panelRole !== 'admin') return forbidden();

  try {
    const rows = await db
      .select({
        id: panelUsers.id,
        username: panelUsers.username,
        displayName: panelUsers.displayName,
        role: panelUsers.role,
        active: panelUsers.active,
        createdAt: panelUsers.createdAt,
      })
      .from(panelUsers)
      .where(eq(panelUsers.tenantId, session.tenantId))
      .orderBy(panelUsers.createdAt);

    return NextResponse.json({ ok: true, users: rows });
  } catch {
    return NextResponse.json({ ok: true, users: [] });
  }
}

// POST — create a new user
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no autenticado' }, { status: 401 });
  if (session.panelRole && session.panelRole !== 'admin') return forbidden();

  const body = (await req.json().catch(() => ({}))) as {
    username?: string;
    password?: string;
    displayName?: string;
    role?: string;
  };

  const username = (body.username ?? '').trim().toLowerCase();
  const password = (body.password ?? '').trim();
  const displayName = (body.displayName ?? '').trim() || null;
  const role = body.role === 'supervisor' ? 'supervisor' : body.role === 'admin' ? 'admin' : 'operador';

  if (!username || username.length < 3) {
    return NextResponse.json({ error: 'nombre de usuario mínimo 3 caracteres' }, { status: 400 });
  }
  if (password.length < 6) {
    return NextResponse.json({ error: 'contraseña mínimo 6 caracteres' }, { status: 400 });
  }

  // Check uniqueness within tenant
  const existing = await db
    .select({ id: panelUsers.id })
    .from(panelUsers)
    .where(and(eq(panelUsers.tenantId, session.tenantId), eq(panelUsers.username, username)))
    .limit(1);

  if (existing.length > 0) {
    return NextResponse.json({ error: 'ya existe un usuario con ese nombre' }, { status: 409 });
  }

  const hash = await bcrypt.hash(password, 10);
  const [created] = await db
    .insert(panelUsers)
    .values({
      tenantId: session.tenantId,
      username,
      passwordHash: hash,
      displayName,
      role,
    })
    .returning({
      id: panelUsers.id,
      username: panelUsers.username,
      displayName: panelUsers.displayName,
      role: panelUsers.role,
      active: panelUsers.active,
      createdAt: panelUsers.createdAt,
    });

  return NextResponse.json({ ok: true, user: created });
}

// PUT — update user (role, active, password, displayName)
export async function PUT(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no autenticado' }, { status: 401 });
  if (session.panelRole && session.panelRole !== 'admin') return forbidden();

  const body = (await req.json().catch(() => ({}))) as {
    id?: string;
    role?: string;
    active?: boolean;
    password?: string;
    username?: string;
    displayName?: string;
  };

  if (!body.id) return NextResponse.json({ error: 'id requerido' }, { status: 400 });

  // Verify user belongs to this tenant
  const [target] = await db
    .select({ id: panelUsers.id, role: panelUsers.role })
    .from(panelUsers)
    .where(and(eq(panelUsers.id, body.id), eq(panelUsers.tenantId, session.tenantId)))
    .limit(1);

  if (!target) return NextResponse.json({ error: 'usuario no encontrado' }, { status: 404 });

  // No permitir que el admin se auto-degrade o auto-desactive (se quedaría sin acceso)
  if (body.id === session.userId) {
    if (body.role !== undefined && body.role !== 'admin') {
      return NextResponse.json({ error: 'no podés cambiar tu propio rol de admin' }, { status: 400 });
    }
    if (body.active === false) {
      return NextResponse.json({ error: 'no podés desactivar tu propio usuario' }, { status: 400 });
    }
  }

  const set: Record<string, unknown> = { updatedAt: new Date() };

  if (body.role !== undefined) {
    const r = body.role === 'supervisor' ? 'supervisor' : body.role === 'admin' ? 'admin' : 'operador';
    set.role = r;
  }
  if (body.active !== undefined) set.active = body.active;
  if (body.password && body.password.trim().length >= 6) {
    set.passwordHash = await bcrypt.hash(body.password.trim(), 10);
  }
  if (body.username !== undefined) {
    const u = body.username.trim().toLowerCase();
    if (u.length >= 3) set.username = u;
  }
  if (body.displayName !== undefined) {
    set.displayName = body.displayName.trim() || null;
  }

  await db.update(panelUsers).set(set).where(eq(panelUsers.id, body.id));

  return NextResponse.json({ ok: true });
}

// DELETE — remove user
export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no autenticado' }, { status: 401 });
  if (session.panelRole && session.panelRole !== 'admin') return forbidden();

  const { id } = (await req.json().catch(() => ({}))) as { id?: string };
  if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 });

  // Prevent deleting yourself
  if (id === session.userId) {
    return NextResponse.json({ error: 'no podés borrar tu propio usuario' }, { status: 400 });
  }

  await db
    .delete(panelUsers)
    .where(and(eq(panelUsers.id, id), eq(panelUsers.tenantId, session.tenantId)));

  return NextResponse.json({ ok: true });
}

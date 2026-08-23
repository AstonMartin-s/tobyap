import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { tenants, panelUsers } from '@/db/schema';
import { setSession } from '@/lib/session';

export async function POST(req: NextRequest) {
  let input: { user?: string; password?: string };
  try {
    input = await req.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }
  const { user, password } = input;
  if (!user || !password) {
    return NextResponse.json({ error: 'usuario y contraseña requeridos' }, { status: 400 });
  }

  // 1. Try panel_users first (new system)
  try {
    const puCandidates = await db
      .select({
        id: panelUsers.id,
        tenantId: panelUsers.tenantId,
        passwordHash: panelUsers.passwordHash,
        role: panelUsers.role,
        displayName: panelUsers.displayName,
        active: panelUsers.active,
      })
      .from(panelUsers)
      .where(eq(panelUsers.username, user));

    for (const pu of puCandidates) {
      if (!pu.active) continue;
      if (await bcrypt.compare(password, pu.passwordHash)) {
        const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, pu.tenantId) });
        if (!tenant || !tenant.active) continue;
        const panelRole = pu.role as 'admin' | 'supervisor' | 'operador';
        await setSession({
          tenantId: tenant.id,
          slug: tenant.slug,
          role: tenant.role ?? 'client',
          panelRole,
          userId: pu.id,
          displayName: pu.displayName ?? undefined,
        });
        return NextResponse.json({ ok: true, role: tenant.role ?? 'client', panelRole });
      }
    }
  } catch {
    // panel_users table might not exist yet — fall through to legacy
  }

  // 2. Legacy: check tenants.panelUser (backwards compatible)
  const candidates = await db.query.tenants.findMany({ where: eq(tenants.panelUser, user) });
  for (const tenant of candidates) {
    if (!tenant.active || !tenant.panelPasswordHash) continue;
    if (await bcrypt.compare(password, tenant.panelPasswordHash)) {
      const role = tenant.role ?? 'client';
      await setSession({
        tenantId: tenant.id,
        slug: tenant.slug,
        role,
        panelRole: 'admin',
      });
      return NextResponse.json({ ok: true, role });
    }
  }

  return NextResponse.json({ error: 'credenciales inválidas' }, { status: 401 });
}

import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { tenants } from '@/db/schema';
import { setSession } from '@/lib/session';

// POST /api/login  { user, password }
// El cliente NO elige tenant: se resuelve por el usuario (panel_user, normalmente el
// email). Si dos tenants comparten panel_user, se desempata por la contraseña.
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

  // Candidatos por usuario (puede haber 0..N). Comparamos password contra cada uno.
  const candidates = await db.query.tenants.findMany({ where: eq(tenants.panelUser, user) });
  for (const tenant of candidates) {
    if (!tenant.active || !tenant.panelPasswordHash) continue;
    if (await bcrypt.compare(password, tenant.panelPasswordHash)) {
      const role = tenant.role ?? 'client';
      await setSession({ tenantId: tenant.id, slug: tenant.slug, role });
      return NextResponse.json({ ok: true, role });
    }
  }

  return NextResponse.json({ error: 'credenciales inválidas' }, { status: 401 });
}

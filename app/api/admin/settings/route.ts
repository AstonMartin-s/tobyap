import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { tenants, clientSettings } from '@/db/schema';
import { isAdmin } from '@/lib/admin-auth';

// Campos de clientSettings editables desde el admin (datos de cuenta: CBU/Titular
// + mensaje de bienvenida). Los usa writeCbu para poblar el lead en cada carga.
const FIELDS = ['accountName', 'accountCbu', 'message', 'regularMessage', 'context', 'walink'] as const;

// PATCH /api/admin/settings  { tenant, accountName?, accountCbu?, message?, ... }
export async function PATCH(req: NextRequest) {
  if (!(await isAdmin(req))) return NextResponse.json({ error: 'no autorizado' }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as Record<string, string | undefined>;
  if (!b.tenant) return NextResponse.json({ error: 'tenant requerido' }, { status: 400 });
  const t = await db.query.tenants.findFirst({ where: eq(tenants.slug, b.tenant) });
  if (!t) return NextResponse.json({ error: 'tenant no encontrado' }, { status: 404 });

  const values: Record<string, string | null> = {};
  for (const f of FIELDS) if (f in b) values[f] = b[f] ?? null;

  await db
    .insert(clientSettings)
    .values({ tenantId: t.id, ...values })
    .onConflictDoUpdate({ target: clientSettings.tenantId, set: { ...values, updatedAt: new Date() } });

  return NextResponse.json({ ok: true });
}

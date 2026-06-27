import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { clientSettings } from '@/db/schema';
import { getSession } from '@/lib/session';

// GET /api/settings — configuración general del tenant logueado (§6.1).
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no autenticado' }, { status: 401 });

  const [row] = await db
    .select()
    .from(clientSettings)
    .where(eq(clientSettings.tenantId, session.tenantId));

  return NextResponse.json({ settings: row ?? null });
}

const FIELDS = ['accountName', 'accountCbu', 'context', 'message', 'regularMessage', 'walink'] as const;

// PUT /api/settings — upsert de la configuración general.
export async function PUT(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no autenticado' }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  // Solo campos permitidos.
  const values: Record<string, string | null> = {};
  for (const f of FIELDS) {
    if (f in body) values[f] = body[f] == null ? null : String(body[f]);
  }

  const [row] = await db
    .insert(clientSettings)
    .values({ tenantId: session.tenantId, ...values })
    .onConflictDoUpdate({
      target: clientSettings.tenantId,
      set: { ...values, updatedAt: new Date() },
    })
    .returning();

  return NextResponse.json({ ok: true, settings: row });
}

import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { clientSettings } from '@/db/schema';
import { getSession } from '@/lib/session';
import { getTenantBySlug } from '@/lib/tenants';
import { parseTiendaConfig, type TiendaConfig } from '@/lib/chat/tienda';

export const dynamic = 'force-dynamic';

// CRUD de la config del nicho TIENDA (productos / pago / entrega / marca).
// Vive en client_settings.chat_config.tienda. Solo para tenants niche='tienda'.

async function loadRow(tenantId: string) {
  const [row] = await db.select().from(clientSettings).where(eq(clientSettings.tenantId, tenantId)).limit(1);
  return row ?? null;
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no autenticado' }, { status: 401 });
  const tenant = await getTenantBySlug(session.slug);
  const row = await loadRow(session.tenantId);
  const tienda = parseTiendaConfig(row?.chatConfig, tenant?.name ?? session.slug);
  return NextResponse.json({ ok: true, niche: tenant?.niche ?? 'circo', tienda });
}

export async function PUT(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no autenticado' }, { status: 401 });
  const tenant = await getTenantBySlug(session.slug);
  if (tenant && tenant.niche !== 'tienda') {
    return NextResponse.json({ error: 'este cliente no es del nicho Tienda' }, { status: 409 });
  }

  const body = (await req.json().catch(() => ({}))) as Partial<TiendaConfig>;
  // Validamos/normalizamos con el parser (defaults seguros). Aceptamos tanto el
  // objeto plano como { tienda: {...} }.
  const clean = parseTiendaConfig(body, tenant?.name ?? session.slug);

  const row = await loadRow(session.tenantId);
  const prev = (row?.chatConfig ?? {}) as Record<string, unknown>;
  const next = { ...prev, tienda: clean };

  const [saved] = await db
    .insert(clientSettings)
    .values({ tenantId: session.tenantId, chatConfig: next })
    .onConflictDoUpdate({ target: clientSettings.tenantId, set: { chatConfig: next, updatedAt: new Date() } })
    .returning();

  return NextResponse.json({ ok: true, tienda: parseTiendaConfig(saved.chatConfig, tenant?.name ?? session.slug) });
}

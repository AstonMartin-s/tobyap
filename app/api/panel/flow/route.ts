import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { clientSettings } from '@/db/schema';
import { getSession } from '@/lib/session';
import { getTenantBySlug } from '@/lib/tenants';
import { parseChatFlow, seedTiendaFlow, type ChatFlow } from '@/lib/chat/flowGraph';

export const dynamic = 'force-dynamic';

// CRUD del guion del chat (grafo de nodos+conectores). Vive en
// client_settings.chat_config.flow. Si no hay flow guardado, devolvemos un seed
// por defecto (deshabilitado) para que el editor arranque con algo usable.

async function loadRow(tenantId: string) {
  const [row] = await db.select().from(clientSettings).where(eq(clientSettings.tenantId, tenantId)).limit(1);
  return row ?? null;
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no autenticado' }, { status: 401 });
  const row = await loadRow(session.tenantId);
  const parsed = parseChatFlow(row?.chatConfig);
  // Sin nodos guardados → seed por defecto (deshabilitado, listo para editar).
  const flow = parsed.nodes.length ? parsed : seedTiendaFlow();
  return NextResponse.json({ ok: true, flow });
}

export async function PUT(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no autenticado' }, { status: 401 });
  const tenant = await getTenantBySlug(session.slug);
  if (tenant && tenant.niche !== 'tienda') {
    return NextResponse.json({ error: 'el guion por nodos es solo del nicho Tienda' }, { status: 409 });
  }

  const body = (await req.json().catch(() => ({}))) as Partial<ChatFlow>;
  const clean = parseChatFlow(body);

  const row = await loadRow(session.tenantId);
  const prev = (row?.chatConfig ?? {}) as Record<string, unknown>;
  const next = { ...prev, flow: clean };

  const [saved] = await db
    .insert(clientSettings)
    .values({ tenantId: session.tenantId, chatConfig: next })
    .onConflictDoUpdate({ target: clientSettings.tenantId, set: { chatConfig: next, updatedAt: new Date() } })
    .returning();

  return NextResponse.json({ ok: true, flow: parseChatFlow(saved.chatConfig) });
}

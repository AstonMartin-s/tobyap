import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { chatSessions } from '@/db/schema';
import { getTenantBySlug } from '@/lib/tenants';
import { onFreeText } from '@/lib/chat/flow';
import { addLeadNote } from '@/lib/chat/kommoMirror';

export const dynamic = 'force-dynamic';

// POST /api/chat/[slug]/message  { sessionKey, text }
export async function POST(req: NextRequest, { params }: { params: { slug: string } }) {
  const tenant = await getTenantBySlug(params.slug);
  if (!tenant) return NextResponse.json({ error: 'tenant desconocido' }, { status: 404 });
  const b = (await req.json().catch(() => ({}))) as { sessionKey?: string; text?: string };
  if (!b.sessionKey || !b.text) return NextResponse.json({ error: 'sessionKey y text requeridos' }, { status: 400 });

  const [s] = await db.select().from(chatSessions).where(and(eq(chatSessions.tenantId, tenant.id), eq(chatSessions.sessionKey, b.sessionKey)));
  if (!s) return NextResponse.json({ error: 'sesión desconocida' }, { status: 404 });
  // Bloqueado: ignoramos el mensaje (no se guarda, no reabre la bandeja).
  if ((s.data as Record<string, unknown> | null)?.blocked) return NextResponse.json({ ok: true, messages: [], blocked: true });

  const replies = onFreeText(s.step ?? 'comprobante', b.text);
  const history = [...(s.messages ?? []), { from: 'user' as const, text: b.text, at: Date.now() }, ...replies.map((m) => ({ from: 'bot' as const, text: m.text, at: m.at }))];
  // Inbound del cliente → marca NO LEÍDO (pendiente de responder) y, si estaba
  // archivado, se reabre solo (vuelve a la bandeja).
  const sdata = (s.data ?? {}) as Record<string, unknown>;
  const patch: Record<string, unknown> = { messages: history, updatedAt: new Date(), data: { ...sdata, unread: true, archived: false } };
  await db.update(chatSessions).set(patch).where(eq(chatSessions.id, s.id));

  if (s.kommoLeadId) addLeadNote(tenant, s.kommoLeadId, `👤 Lead: ${b.text}`);

  return NextResponse.json({ ok: true, messages: replies, total: history.length });
}

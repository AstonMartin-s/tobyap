import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { clientSettings } from '@/db/schema';
import { getSession } from '@/lib/session';
import { parseChatConfig } from '@/lib/chat/brand';
import { saveBrandAvatar } from '@/lib/storage';

export const dynamic = 'force-dynamic';

async function loadRow(tenantId: string) {
  const [row] = await db.select().from(clientSettings).where(eq(clientSettings.tenantId, tenantId)).limit(1);
  return row ?? null;
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no autenticado' }, { status: 401 });
  try {
    const row = await loadRow(session.tenantId);
    const brand = parseChatConfig(row?.chatConfig, session.slug, session.slug);
    return NextResponse.json({ ok: true, brand, raw: row?.chatConfig ?? {} });
  } catch {
    return NextResponse.json({
      ok: false,
      error: 'Falta columna chat_config (migración pendiente, no deploy)',
      brand: parseChatConfig({}, session.slug, session.slug),
    }, { status: 503 });
  }
}

export async function PUT(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no autenticado' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { brandName?: string; primaryColor?: string; avatarUrl?: string | null };
  const row = await loadRow(session.tenantId);
  const prev = (row?.chatConfig ?? {}) as Record<string, unknown>;
  const next = {
    ...prev,
    brandName: typeof body.brandName === 'string' ? body.brandName.trim() : prev.brandName,
    primaryColor: typeof body.primaryColor === 'string' ? body.primaryColor.trim() : prev.primaryColor,
    avatarUrl: body.avatarUrl === null ? null : typeof body.avatarUrl === 'string' ? body.avatarUrl.trim() : prev.avatarUrl,
  };
  const [saved] = await db
    .insert(clientSettings)
    .values({ tenantId: session.tenantId, chatConfig: next })
    .onConflictDoUpdate({ target: clientSettings.tenantId, set: { chatConfig: next, updatedAt: new Date() } })
    .returning();
  return NextResponse.json({ ok: true, brand: parseChatConfig(saved.chatConfig, session.slug, session.slug) });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no autenticado' }, { status: 401 });
  const form = await req.formData().catch(() => null);
  const file = form?.get('avatar');
  if (!(file instanceof File)) return NextResponse.json({ error: 'avatar requerido' }, { status: 400 });
  if (file.size > 2 * 1024 * 1024) return NextResponse.json({ error: 'imagen muy pesada (máx 2MB)' }, { status: 413 });
  const buf = Buffer.from(await file.arrayBuffer());
  const mime = file.type || 'image/jpeg';
  const rel = await saveBrandAvatar(session.tenantId, buf, mime);
  if (!rel) return NextResponse.json({ error: 'UPLOAD_DIR no configurado; pegá una URL de imagen' }, { status: 400 });

  const row = await loadRow(session.tenantId);
  const prev = (row?.chatConfig ?? {}) as Record<string, unknown>;
  const next = { ...prev, avatarPath: rel, avatarUrl: `/api/chat/${session.slug}/avatar` };
  await db
    .insert(clientSettings)
    .values({ tenantId: session.tenantId, chatConfig: next })
    .onConflictDoUpdate({ target: clientSettings.tenantId, set: { chatConfig: next, updatedAt: new Date() } });
  return NextResponse.json({ ok: true, brand: parseChatConfig(next, session.slug, session.slug) });
}

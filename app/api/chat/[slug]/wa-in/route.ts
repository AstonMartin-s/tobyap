import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { chatSessions } from '@/db/schema';
import { getTenantBySlug } from '@/lib/tenants';
import { appendChatMessages } from '@/lib/chat/mutations';

export const dynamic = 'force-dynamic';

// POST /api/chat/[slug]/wa-in
// Entrantes de WhatsApp reenviados por Blaster. Firma HMAC-SHA256 del body crudo.
// Crea o rehidrata una sesión channel='whatsapp'. Siempre 200 salvo firma inválida.

const SEEN_RING = 25;

function verifySignature(secret: string, rawBody: string, header: string | null): boolean {
  if (!header) return false;
  const provided = header.startsWith('sha256=') ? header.slice(7) : header;
  const expected = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(provided.trim(), 'utf8');
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function mimeFromB64(b64: string): string {
  if (b64.startsWith('/9j/')) return 'image/jpeg';
  if (b64.startsWith('iVBOR')) return 'image/png';
  if (b64.startsWith('R0lG')) return 'image/gif';
  if (b64.startsWith('UklGR')) return 'image/webp';
  return 'image/jpeg';
}

export async function POST(req: NextRequest, { params }: { params: { slug: string } }) {
  const tenant = await getTenantBySlug(params.slug);
  if (!tenant) return NextResponse.json({ ok: true, ignored: 'tenant' });

  const secret = tenant.waInboundSecret;
  if (!secret) return NextResponse.json({ error: 'canal WhatsApp no configurado' }, { status: 401 });

  const rawBody = await req.text();
  const sig = req.headers.get('x-signature') ?? req.headers.get('x-signature-256');
  if (!verifySignature(secret, rawBody, sig)) {
    return NextResponse.json({ error: 'firma inválida' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: true, ignored: 'json' });
  }

  const messageId = typeof body.message_id === 'string' ? body.message_id : '';
  const fromRaw = typeof body.from === 'string' ? body.from : '';
  const type = body.type === 'image' ? 'image' : 'text';
  const text = typeof body.text === 'string' ? body.text : '';
  const mediaB64 = typeof body.media_base64 === 'string' ? body.media_base64 : '';
  const atSec = typeof body.at === 'number' ? body.at : 0;
  const at = atSec > 0 ? (atSec < 1e12 ? atSec * 1000 : atSec) : Date.now();
  const phone = (fromRaw ?? '').replace(/\D/g, '');
  if (!phone) return NextResponse.json({ ok: true, ignored: 'phone' });
  if (type === 'text' && !text && !mediaB64) return NextResponse.json({ ok: true, ignored: 'empty' });

  const [existing] = await db
    .select()
    .from(chatSessions)
    .where(and(
      eq(chatSessions.tenantId, tenant.id),
      eq(chatSessions.phone, phone),
      eq(chatSessions.channel, 'whatsapp'),
    ))
    .orderBy(desc(chatSessions.updatedAt))
    .limit(1);

  const [liveMatch] = await db
    .select({ id: chatSessions.id })
    .from(chatSessions)
    .where(and(
      eq(chatSessions.tenantId, tenant.id),
      eq(chatSessions.phone, phone),
      eq(chatSessions.channel, 'livechat'),
    ))
    .limit(1);

  const msg: { from: 'user'; text?: string; image?: string; at: number } = { from: 'user', at };
  if (type === 'image' && mediaB64) {
    msg.image = mediaB64.startsWith('data:') ? mediaB64 : `data:${mimeFromB64(mediaB64)};base64,${mediaB64}`;
    if (text) msg.text = text;
  } else {
    msg.text = text;
  }

  if (existing) {
    const sdata = (existing.data ?? {}) as Record<string, unknown>;
    const seen = Array.isArray(sdata.waSeen) ? (sdata.waSeen as unknown[]).map(String) : [];
    if (messageId && seen.includes(messageId)) {
      return NextResponse.json({ ok: true, duplicate: true });
    }
    const nextSeen = messageId ? [...seen, messageId].slice(-SEEN_RING) : seen;
    await appendChatMessages(existing.id, [msg], {
      markUnread: true,
      dataMerge: {
        waSeen: nextSeen,
        ...(liveMatch ? { fromLivechat: true } : {}),
      },
    });
    return NextResponse.json({ ok: true, sessionKey: existing.sessionKey });
  }

  const sessionKey = crypto.randomBytes(12).toString('hex');
  await db.insert(chatSessions).values({
    tenantId: tenant.id,
    sessionKey,
    phone,
    name: null,
    channel: 'whatsapp',
    step: 'wa',
    data: {
      waSeen: messageId ? [messageId] : [],
      unread: true,
      unreadCount: 1,
      ...(liveMatch ? { fromLivechat: true } : {}),
    },
    messages: [msg],
    updatedAt: new Date(),
  });
  return NextResponse.json({ ok: true, sessionKey, created: true });
}

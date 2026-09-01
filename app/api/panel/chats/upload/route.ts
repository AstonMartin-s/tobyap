import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { chatSessions } from '@/db/schema';
import { getSession } from '@/lib/session';
import { appendChatMessages } from '@/lib/chat/mutations';
import { saveComprobante, isDangerousUploadMime } from '@/lib/storage';
import { signFilePath } from '@/lib/chat/fileToken';
import { normalizeUploadImage } from '@/lib/chat/image';

export const dynamic = 'force-dynamic';

const MAX_BYTES = 10 * 1024 * 1024; // 10MB

// POST /api/panel/chats/upload (multipart: sessionKey, image) — el OPERADOR manda
// una imagen al cliente desde el panel (ej. pegando con Ctrl+V en la respuesta).
// Se guarda igual que un comprobante (volumen/base64 + URL firmada por cid) y se
// anexa como mensaje del operador (from:'bot', op:true) para que salga en su chat.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no autorizado' }, { status: 401 });

  const form = await req.formData().catch(() => null);
  const sessionKey = form?.get('sessionKey')?.toString();
  const file = form?.get('image');
  if (!sessionKey || !(file instanceof File)) {
    return NextResponse.json({ error: 'sessionKey e image requeridos' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'archivo muy pesado (máx 10MB)' }, { status: 413 });

  const [s] = await db
    .select()
    .from(chatSessions)
    .where(and(eq(chatSessions.tenantId, session.tenantId), eq(chatSessions.sessionKey, sessionKey)));
  if (!s) return NextResponse.json({ error: 'sesión desconocida' }, { status: 404 });

  const rawBuf = Buffer.from(await file.arrayBuffer());
  // Mismo hardening que el upload del cliente: nada de svg/html/xml ejecutable.
  if (isDangerousUploadMime(file.type) || isDangerousUploadMime(file.name)) {
    return NextResponse.json({ error: 'formato de imagen no permitido' }, { status: 415 });
  }
  const { buf, mime } = await normalizeUploadImage(rawBuf, file.type || '', file.name || '');
  if (isDangerousUploadMime(mime)) {
    return NextResponse.json({ error: 'formato de imagen no permitido' }, { status: 415 });
  }

  const cid = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const fileUrl = signFilePath(session.slug, sessionKey, cid);
  const storedPath = await saveComprobante(sessionKey, buf, mime).catch(() => null);

  const at = Date.now();
  const entry = {
    id: cid,
    ...(storedPath ? { path: storedPath } : { b64: buf.toString('base64') }),
    mime,
    name: file.name,
    at,
    op: true, // imagen del OPERADOR (no cuenta como comprobante del cliente)
  };
  const msg = { from: 'bot' as const, image: fileUrl, at, op: true };
  await appendChatMessages(s.id, [msg], { dataAppend: { comprobantes: [entry] } });

  return NextResponse.json({ ok: true, fileUrl });
}

import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { chatSessions } from '@/db/schema';
import { getTenantBySlug } from '@/lib/tenants';
import { onComprobante } from '@/lib/chat/flow';
import { prepareBotBatch } from '@/lib/chat/stagger';
import { appendChatMessages } from '@/lib/chat/mutations';
import { addLeadNote } from '@/lib/chat/kommoMirror';
import { saveComprobante } from '@/lib/storage';
import { signFilePath } from '@/lib/chat/fileToken';
import { normalizeUploadImage } from '@/lib/chat/image';

export const dynamic = 'force-dynamic';

const MAX_BYTES = 4 * 1024 * 1024; // 4MB

// POST /api/chat/[slug]/upload  (multipart: sessionKey, image) — guarda la IMAGEN
// real del comprobante (base64 en la sesión), la sirve vía /file y deja el link
// en una nota del lead para que el operador la vea desde Kommo.
export async function POST(req: NextRequest, { params }: { params: { slug: string } }) {
  const tenant = await getTenantBySlug(params.slug);
  if (!tenant) return NextResponse.json({ error: 'tenant desconocido' }, { status: 404 });

  const form = await req.formData().catch(() => null);
  const sessionKey = form?.get('sessionKey')?.toString();
  const file = form?.get('image');
  if (!sessionKey || !(file instanceof File)) return NextResponse.json({ error: 'sessionKey e image requeridos' }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'imagen muy pesada (máx 4MB)' }, { status: 413 });

  const [s] = await db.select().from(chatSessions).where(and(eq(chatSessions.tenantId, tenant.id), eq(chatSessions.sessionKey, sessionKey)));
  if (!s) return NextResponse.json({ error: 'sesión desconocida' }, { status: 404 });
  if ((s.data as Record<string, unknown> | null)?.blocked) return NextResponse.json({ ok: true, messages: [], blocked: true });

  const rawBuf = Buffer.from(await file.arrayBuffer());
  // iPhone sube HEIC/HEIF (no lo renderizan los navegadores) → lo pasamos a JPEG
  // para no "perder" comprobantes invisibles. El resto de formatos pasa igual.
  const { buf, mime } = await normalizeUploadImage(rawBuf, file.type || '', file.name || '');
  const fileUrl = signFilePath(params.slug, sessionKey);

  // Guardamos en el volumen si está configurado (barato, fuera de la DB). Si no,
  // caemos a base64 en la sesión (comportamiento anterior).
  const storedPath = await saveComprobante(sessionKey, buf, mime).catch(() => null);

  const botMsgs = prepareBotBatch(onComprobante());
  const newMsgs = [
    { from: 'user' as const, image: fileUrl, at: Date.now() },
    ...botMsgs,
  ];
  // Append atómico + merge de data (no pisa mensajes ni flags concurrentes).
  await appendChatMessages(s.id, newMsgs, {
    step: 'app_onboarding', // primero instala app + notificaciones, luego entra a revisión
    markUnread: true,
    dataMerge: {
      ...(storedPath ? { comprobantePath: storedPath } : { comprobante: buf.toString('base64') }),
      comprobanteMime: mime,
      comprobanteName: file.name,
      comprobanteAt: Date.now(), // para la limpieza automática a las 48h
    },
    // Si quedó en disco, borramos cualquier base64 viejo de un intento anterior.
    dataRemove: storedPath ? ['comprobante'] : [],
  });
  const history = [...(s.messages ?? []), ...newMsgs];

  if (s.kommoLeadId) {
    // URL pública real (detrás del proxy de Railway, req.nextUrl.origin miente).
    const base = process.env.APP_PUBLIC_URL ?? 'https://tobyap-production.up.railway.app';
    addLeadNote(tenant, s.kommoLeadId, `📸 Comprobante recibido (${file.name}).\nVerlo: ${base}${fileUrl}\n(El cliente está completando la instalación de la app para enviarlo.)`);
  }

  return NextResponse.json({ ok: true, messages: botMsgs, step: 'app_onboarding', fileUrl, total: history.length });
}

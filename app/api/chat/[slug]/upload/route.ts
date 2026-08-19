import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { chatSessions } from '@/db/schema';
import { getTenantBySlug } from '@/lib/tenants';
import { onComprobante } from '@/lib/chat/flow';
import { addLeadNote } from '@/lib/chat/kommoMirror';
import { saveComprobante } from '@/lib/storage';

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

  const buf = Buffer.from(await file.arrayBuffer());
  const mime = file.type || 'image/jpeg';
  const fileUrl = `/api/chat/${params.slug}/file?sessionKey=${sessionKey}`;

  // Guardamos en el volumen si está configurado (barato, fuera de la DB). Si no,
  // caemos a base64 en la sesión (comportamiento anterior).
  const storedPath = await saveComprobante(sessionKey, buf, mime).catch(() => null);

  const replies = onComprobante();
  const history = [
    ...(s.messages ?? []),
    { from: 'user' as const, image: fileUrl, at: Date.now() },
    ...replies.map((m) => ({ from: 'bot' as const, text: m.text, at: m.at })),
  ];
  await db.update(chatSessions).set({
    messages: history,
    step: 'app_onboarding', // primero instala app + notificaciones, luego entra a revisión
    data: {
      ...(s.data ?? {}),
      archived: false, // mandó comprobante → activo, se reabre si estaba archivado
      unread: true, // comprobante nuevo → pendiente de revisar
      // En disco: guardamos la ruta y NADA de base64 (DB liviana). En fallback: base64.
      ...(storedPath ? { comprobantePath: storedPath, comprobante: undefined } : { comprobante: buf.toString('base64') }),
      comprobanteMime: mime,
      comprobanteName: file.name,
      comprobanteAt: Date.now(), // para la limpieza automática a las 48h
    },
    updatedAt: new Date(),
  }).where(eq(chatSessions.id, s.id));

  if (s.kommoLeadId) {
    // URL pública real (detrás del proxy de Railway, req.nextUrl.origin miente).
    const base = process.env.APP_PUBLIC_URL ?? 'https://tobyap-production.up.railway.app';
    addLeadNote(tenant, s.kommoLeadId, `📸 Comprobante recibido (${file.name}).\nVerlo: ${base}${fileUrl}\n(El cliente está completando la instalación de la app para enviarlo.)`);
  }

  return NextResponse.json({ ok: true, messages: replies, step: 'app_onboarding', fileUrl, total: history.length });
}

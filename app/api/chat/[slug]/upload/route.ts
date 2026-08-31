import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { chatSessions } from '@/db/schema';
import { getTenantBySlug } from '@/lib/tenants';
import { onComprobante, comprobanteReviewMessages } from '@/lib/chat/flow';
import { comprobanteReviewTienda } from '@/lib/chat/flows/tienda';
import { prepareBotBatch } from '@/lib/chat/stagger';
import { appendChatMessages } from '@/lib/chat/mutations';
import { loadChatRuntime } from '@/lib/chat/loadRuntime';
import { addLeadNote } from '@/lib/chat/kommoMirror';
import { updateLeadStatus } from '@/lib/kommo';
import { saveComprobante } from '@/lib/storage';
import { signFilePath } from '@/lib/chat/fileToken';
import { normalizeUploadImage } from '@/lib/chat/image';

export const dynamic = 'force-dynamic';

const MAX_BYTES = 10 * 1024 * 1024; // 10MB — cubre fotos grandes y PDFs de comprobante

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
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'archivo muy pesado (máx 10MB)' }, { status: 413 });

  const [s] = await db.select().from(chatSessions).where(and(eq(chatSessions.tenantId, tenant.id), eq(chatSessions.sessionKey, sessionKey)));
  if (!s) return NextResponse.json({ error: 'sesión desconocida' }, { status: 404 });
  if ((s.data as Record<string, unknown> | null)?.blocked) return NextResponse.json({ ok: true, messages: [], blocked: true });

  const rawBuf = Buffer.from(await file.arrayBuffer());
  // iPhone sube HEIC/HEIF (no lo renderizan los navegadores) → lo pasamos a JPEG
  // para no "perder" comprobantes invisibles. El resto de formatos pasa igual.
  const { buf, mime } = await normalizeUploadImage(rawBuf, file.type || '', file.name || '');
  // cid único por comprobante → URL única. Antes todas las cargas de una sesión
  // compartían URL y `/file` servía siempre la última, "borrando" las anteriores.
  const cid = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const fileUrl = signFilePath(params.slug, sessionKey, cid);

  // Guardamos en el volumen si está configurado (barato, fuera de la DB). Si no,
  // caemos a base64 en la sesión (comportamiento anterior).
  const storedPath = await saveComprobante(sessionKey, buf, mime).catch(() => null);

  const runtime = await loadChatRuntime(tenant.id, tenant.name, s.phone, tenant.slug);

  // GATE de app SOLO con el primer comprobante. En los siguientes NO volvemos a
  // condicionar el envío: la imagen entra directo a revisión y, si todavía no
  // activó la app, se le recuerda una sola vez de forma tranquila (opcional).
  const data0 = (s.data as Record<string, unknown> | null) ?? {};
  const firstComprobante = data0.comprobanteSentOnce !== true;
  const appActivated = data0.appInstall === true || data0.appNotif === true;

  let step: string;
  let botMsgs: ReturnType<typeof prepareBotBatch>;
  if (tenant.niche === 'tienda') {
    // Tienda: sin gate de app. El comprobante entra directo a verificación.
    step = 'validando';
    botMsgs = prepareBotBatch(comprobanteReviewTienda());
  } else if (firstComprobante) {
    step = 'app_onboarding'; // primero instala app + notificaciones, luego entra a revisión
    botMsgs = prepareBotBatch(onComprobante(runtime));
  } else {
    step = 'validando';
    botMsgs = prepareBotBatch(comprobanteReviewMessages(runtime));
    if (!appActivated) {
      botMsgs.push({
        from: 'bot',
        text: '📲 Si querés, activá las notificaciones desde el menú para enterarte al toque cuando te acreditamos y de tus bonos semanales. Es opcional 🎁',
        at: Date.now(),
      });
    }
  }

  const newMsgs = [
    { from: 'user' as const, image: fileUrl, at: Date.now() },
    ...botMsgs,
  ];
  // Entrada del comprobante en la LISTA (cada carga conserva la suya, con su cid).
  const at = Date.now();
  const entry = {
    id: cid,
    ...(storedPath ? { path: storedPath } : { b64: buf.toString('base64') }),
    mime,
    name: file.name,
    at,
  };
  // Append atómico + merge de data (no pisa mensajes ni flags concurrentes).
  await appendChatMessages(s.id, newMsgs, {
    step,
    markUnread: true,
    dataMerge: {
      // Campos legacy = ÚLTIMO comprobante (compat con /file viejo, limpieza 48h,
      // borrado de sesión). El detalle por-comprobante vive en `comprobantes[]`.
      ...(storedPath ? { comprobantePath: storedPath } : { comprobante: buf.toString('base64') }),
      comprobanteMime: mime,
      comprobanteName: file.name,
      comprobanteAt: at, // para la limpieza automática a las 48h
      comprobanteSentOnce: true,
    },
    dataAppend: { comprobantes: [entry] },
    // Si quedó en disco, borramos cualquier base64 legacy de un intento anterior.
    dataRemove: storedPath ? ['comprobante'] : [],
  });
  const history = [...(s.messages ?? []), ...newMsgs];

  if (s.kommoLeadId) {
    // URL pública real (detrás del proxy de Railway, req.nextUrl.origin miente).
    const base = process.env.APP_PUBLIC_URL ?? 'https://tobyap-production.up.railway.app';
    if (firstComprobante) {
      addLeadNote(tenant, s.kommoLeadId, `📸 Comprobante recibido (${file.name}).\nVerlo: ${base}${fileUrl}\n(El cliente está completando la instalación de la app para enviarlo.)`);
    } else {
      addLeadNote(tenant, s.kommoLeadId, `📸 Nuevo comprobante recibido (${file.name}).\nVerlo: ${base}${fileUrl}\n🔎 Chequealo y mové a Cargo$ para acreditar.`);
      if (tenant.statusRevisarImagenId) updateLeadStatus(tenant, s.kommoLeadId, tenant.statusRevisarImagenId).catch(() => {});
    }
  }

  return NextResponse.json({ ok: true, messages: botMsgs, step, fileUrl, total: history.length });
}

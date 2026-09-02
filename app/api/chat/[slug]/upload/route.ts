import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { chatSessions } from '@/db/schema';
import { getTenantBySlug } from '@/lib/tenants';
import { onComprobante, comprobanteReviewMessages } from '@/lib/chat/flow';
import { comprobanteReviewTienda } from '@/lib/chat/flows/tienda';
import { prepareBotBatch } from '@/lib/chat/stagger';
import { appendChatMessages, mergeChatData } from '@/lib/chat/mutations';
import { loadChatRuntime } from '@/lib/chat/loadRuntime';
import { addLeadNote } from '@/lib/chat/kommoMirror';
import { updateLeadStatus } from '@/lib/kommo';
import { saveComprobante, isDangerousUploadMime } from '@/lib/storage';
import { signFilePath } from '@/lib/chat/fileToken';
import { normalizeUploadImage } from '@/lib/chat/image';

export const dynamic = 'force-dynamic';

const MAX_BYTES = 10 * 1024 * 1024; // 10MB — cubre fotos grandes y PDFs de comprobante

// Anti-spam de subidas: máx N imágenes por ventana; si se pasa, bloqueo temporal
// de la subida (el resto del chat sigue funcionando). No afecta al uso normal
// (un cliente sube 1-3 comprobantes), solo frena el flood.
const RATE_MAX = 5;
const RATE_WINDOW_MS = 60_000; // 1 minuto
const RATE_BLOCK_MS = 3 * 60_000; // 3 minutos de enfriamiento

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

  // Rate limit por sesión: si ya está en enfriamiento, o si superó RATE_MAX en la
  // última ventana, rechazamos 429 (y activamos el enfriamiento). Contamos por el
  // `at` de los comprobantes ya guardados en la sesión.
  const dataRl = (s.data as Record<string, unknown> | null) ?? {};
  const nowMs = Date.now();
  const blockUntil = typeof dataRl.uploadBlockUntil === 'number' ? dataRl.uploadBlockUntil : 0;
  if (blockUntil > nowMs) {
    const secs = Math.ceil((blockUntil - nowMs) / 1000);
    return NextResponse.json(
      { ok: false, rateLimited: true, error: `Estás enviando imágenes muy seguido. Esperá ${secs}s e intentá de nuevo.`, retryAfter: secs },
      { status: 429, headers: { 'Retry-After': String(secs) } },
    );
  }
  const recentCount = Array.isArray(dataRl.comprobantes)
    ? (dataRl.comprobantes as Array<{ at?: number; op?: boolean }>).filter((c) => !c?.op && typeof c?.at === 'number' && nowMs - (c.at as number) < RATE_WINDOW_MS).length
    : 0;
  if (recentCount >= RATE_MAX) {
    await mergeChatData(s.id, { uploadBlockUntil: nowMs + RATE_BLOCK_MS });
    const secs = Math.ceil(RATE_BLOCK_MS / 1000);
    return NextResponse.json(
      { ok: false, rateLimited: true, error: `Estás enviando demasiadas imágenes. Esperá unos minutos e intentá de nuevo.`, retryAfter: secs },
      { status: 429, headers: { 'Retry-After': String(secs) } },
    );
  }

  const rawBuf = Buffer.from(await file.arrayBuffer());
  // iPhone sube HEIC/HEIF (no lo renderizan los navegadores) → lo pasamos a JPEG
  // para no "perder" comprobantes invisibles. El resto de formatos pasa igual.
  // Rechazamos formatos que ejecutan script al servirse (svg/html/xml). Un
  // comprobante legítimo es una foto o PDF, nunca esto.
  if (isDangerousUploadMime(file.type) || isDangerousUploadMime(file.name)) {
    return NextResponse.json({ error: 'formato de imagen no permitido' }, { status: 415 });
  }
  const { buf, mime } = await normalizeUploadImage(rawBuf, file.type || '', file.name || '');
  if (isDangerousUploadMime(mime)) {
    return NextResponse.json({ error: 'formato de imagen no permitido' }, { status: 415 });
  }
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

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { attributions } from '@/db/schema';
import { getTenantBySlug } from '@/lib/tenants';
import { sendCapiEvent, eventExists, type BaseEventName } from '@/lib/meta';
import { parseLeadId } from '@/lib/attribution';

export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// POST /api/webhooks/affiliate/[slug]
//
// Afiliados de bot de Telegram (caja negra). La plataforma del cliente nos hace
// POST server→server cuando ocurre una conversión, identificada por el `code`
// (sub-id) que nosotros mandamos en t.me/<bot>?start=<code>. Buscamos la
// atribución por ese code y disparamos el evento CAPI a Meta.
//
//   Body: { lead_id: "<code>", event_type: "registro"|"carga", timestamp: ISO8601 }
//   Auth (cualquiera de las dos, el cliente elige):
//     · Authorization: Bearer <secret>   ← simple, recomendado (lo que pidió el bot)
//     · X-Signature: hex(hmac-sha256(secret, rawBody))   ← alternativa firmada
//   Mapeo: registro → Conversacion · carga → Cargo.
//   Dedup: event_id = conv-<lead_id> / cargo-<lead_id> (reintentos seguros).
//
// El cliente nos manda TODAS las cargas (depósitos), pero la métrica que medimos
// es la PRIMERA: como el event_id de carga es cargo-<lead_id>, la 1ª dispara el
// evento Meta y las siguientes vuelven 200 {duplicate:true} sin duplicar en Meta.
// Aceptamos "carga" y "primera carga" como sinónimos por compatibilidad.
// ---------------------------------------------------------------------------

/** Comparación en tiempo constante de dos strings (evita timing attacks). */
function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  try {
    return crypto.timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

/** Bearer token en el header Authorization (o X-Webhook-Token como alias). */
function verifyBearer(secret: string, authHeader: string | null, altHeader: string | null): boolean {
  const fromAuth = authHeader?.trim().replace(/^Bearer\s+/i, '') ?? '';
  const token = fromAuth || altHeader?.trim() || '';
  return token.length > 0 && safeEqual(token, secret);
}

function verifySignature(secret: string, rawBody: string, header: string | null): boolean {
  if (!header) return false;
  // Toleramos "sha256=<hex>" (estilo GitHub) o el hex pelado.
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

export async function POST(req: NextRequest, { params }: { params: { slug: string } }) {
  const tenant = await getTenantBySlug(params.slug);
  if (!tenant) return NextResponse.json({ error: 'tenant desconocido' }, { status: 404 });

  // Firmamos/verificamos sobre el body CRUDO (no reserializado): así el HMAC
  // coincide byte a byte con lo que firmó el cliente.
  const rawBody = await req.text();

  const secret = tenant.affiliateWebhookSecret;
  if (!secret) {
    // Sin secreto configurado no podemos autenticar → tratamos como no autorizado.
    return NextResponse.json({ error: 'webhook no configurado' }, { status: 401 });
  }
  // Autenticación: aceptamos Bearer token (recomendado por el cliente) O firma
  // HMAC. Con que una valide, alcanza. Ambas comparan contra el mismo secreto
  // cifrado del tenant, así que rotarlo invalida las dos a la vez.
  const authHeader = req.headers.get('authorization');
  const altToken = req.headers.get('x-webhook-token');
  const sig = req.headers.get('x-signature') ?? req.headers.get('x-signature-256');
  const authorized =
    verifyBearer(secret, authHeader, altToken) || verifySignature(secret, rawBody, sig);
  if (!authorized) {
    return NextResponse.json({ error: 'no autorizado' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const leadIdRaw = typeof body.lead_id === 'string' ? body.lead_id : '';
  const eventType = typeof body.event_type === 'string' ? body.event_type : '';
  const timestamp = typeof body.timestamp === 'string' ? body.timestamp : '';
  if (!leadIdRaw || !eventType) {
    return NextResponse.json({ error: 'payload inválido' }, { status: 400 });
  }

  const base: BaseEventName | null =
    eventType === 'registro'
      ? 'Conversacion'
      : eventType === 'carga' || eventType === 'primera carga'
        ? 'Cargo'
        : null;
  if (!base) {
    return NextResponse.json({ error: 'event_type desconocido' }, { status: 400 });
  }

  const code = parseLeadId(leadIdRaw);
  const attr = await db.query.attributions.findFirst({
    where: and(eq(attributions.tenantId, tenant.id), eq(attributions.code, code)),
  });
  // Sin match no disparamos (200 para que no reintenten): el usuario pudo entrar
  // sin pasar por nuestra landing, o el code no es nuestro.
  if (!attr) {
    return NextResponse.json({ ok: true, unmatched: true });
  }

  const eventId = `${base === 'Conversacion' ? 'conv' : 'cargo'}-${leadIdRaw}`;
  if (await eventExists(tenant.id, eventId)) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  const parsedTs = timestamp ? new Date(timestamp) : new Date();
  const eventTime = Number.isNaN(parsedTs.getTime()) ? new Date() : parsedTs;

  try {
    const res = await sendCapiEvent(tenant, {
      eventName: base,
      eventId,
      userData: { fbc: attr.fbc, fbp: attr.fbp, fbclid: attr.fbclid },
      customData: { campaign_id: attr.campaignId, internal_event: `${base}CRM` },
      eventSourceUrl: attr.eventSourceUrl,
      eventTime,
      actionSource: 'website',
    });
    if (!res.ok) {
      // Fallo transitorio de Meta → 5xx para que el cliente reintente con backoff.
      // El evento quedó persistido como 'failed' (dedup por eventId al reintentar).
      return NextResponse.json({ ok: false, error: 'meta rechazó el evento' }, { status: 502 });
    }
    return NextResponse.json({ ok: true, eventId, eventName: res.eventName });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

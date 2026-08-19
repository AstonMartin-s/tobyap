import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { a3Conversations } from '@/db/schema';
import { a3LineByKey, a3LineByPhoneNumberId, a3VerifyToken, A3_CAMPAIGN_MARKER } from '@/lib/a3/config';
import { phoneKey } from '@/lib/phone';

// ===========================================================================
// MÓDULO AISLADO A3 — relay del webhook de WhatsApp (Meta) para Pagoda.
//
//   GET  /api/a3/webhook/<line>  -> verificación de Meta (hub.challenge)
//   POST /api/a3/webhook/<line>  -> (1) registra conversación NUEVA
//                                   (2) reenvía el body CRUDO a Pagoda (intacto)
//
// No toca tenants ni el circuito existente. Si algo de acá falla, Pagoda igual
// recibe el reenvío (el reenvío es lo prioritario).
// ===========================================================================

export const dynamic = 'force-dynamic';

// --- Verificación del webhook (Meta hace un GET al suscribir) --------------
export async function GET(req: NextRequest, { params }: { params: { line: string } }) {
  const line = a3LineByKey(params.line);
  const sp = req.nextUrl.searchParams;
  const mode = sp.get('hub.mode');
  const token = sp.get('hub.verify_token');
  const challenge = sp.get('hub.challenge');
  const global = a3VerifyToken();
  const ok = mode === 'subscribe' && ((global && token === global) || (line && token === line.verifyToken));
  if (ok) {
    return new NextResponse(challenge ?? '', { status: 200, headers: { 'Content-Type': 'text/plain' } });
  }
  return new NextResponse('forbidden', { status: 403 });
}

// --- Recepción de eventos + reenvío a Pagoda -------------------------------
export async function POST(req: NextRequest, { params }: { params: { line: string } }) {
  const line = a3LineByKey(params.line);
  const raw = await req.text();

  // Modelo por defecto (2da app suscrita a la WABA): Pagoda recibe su copia
  // directo de Meta → NO reenviamos. Solo si la línea tiene forward=true
  // (modelo relay) reenviamos el body crudo + firma a Pagoda.
  if (line?.forward && line.pagodaWebhookUrl) {
    const sig = req.headers.get('x-hub-signature-256');
    fetch(line.pagodaWebhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(sig ? { 'X-Hub-Signature-256': sig } : {}),
      },
      body: raw,
    }).catch((e) => console.error(`[a3 ${params.line}] reenvío a Pagoda falló:`, e));
  } else if (!line) {
    console.error(`[a3] línea desconocida: ${params.line}`);
  }

  // 2) Registrar conversación nueva (best-effort; nunca frena el 200 a Meta).
  try {
    const body = JSON.parse(raw);
    for (const entry of body?.entry ?? []) {
      for (const change of entry?.changes ?? []) {
        // Ruteo por número: preferimos el phone_number_id del payload; si no
        // matchea, caemos a la línea de la URL.
        const pnid = change?.value?.metadata?.phone_number_id as string | undefined;
        const lineKey = a3LineByPhoneNumberId(pnid)?.key ?? params.line;
        for (const m of (change?.value?.messages ?? []) as Array<{ from?: string; id?: string; text?: { body?: string } }>) {
          if (!m.from) continue;
          const key = phoneKey(m.from);
          if (!key) continue;
          const txt = m.text?.body ?? '';
          const campaign = txt.match(A3_CAMPAIGN_MARKER)?.[1] ?? null;
          // Unique (line, phone) -> la primera vez = conversación nueva; luego no-op.
          await db
            .insert(a3Conversations)
            .values({ line: lineKey, phoneKey: key, phone: m.from, campaign, firstText: txt.slice(0, 300), waMessageId: m.id ?? null })
            .onConflictDoNothing();
        }
      }
    }
  } catch (e) {
    console.error(`[a3 ${params.line}] registro falló:`, e);
  }

  // Siempre 200 para que Meta no reintente (y no duplique el reenvío a Pagoda).
  return NextResponse.json({ ok: true });
}

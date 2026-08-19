import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { kommoWebhookLog } from '@/db/schema';

export const dynamic = 'force-dynamic';

// Webhook del canal de Chat API (amojo). Kommo envía acá los mensajes salientes
// (del operador/salesbot) y eventos, con :scope_id en la URL para identificar la
// cuenta. Por ahora registra el payload (stub) — el procesamiento completo
// (Adaptador A: entregar al widget) se implementa cuando tengamos las credenciales
// del canal (channel_id/secret) de soporte de Kommo.
//
// URL a registrar: https://tobyap-production.up.railway.app/api/chat/amojo/:scope_id

export async function GET(_req: NextRequest, { params }: { params: { scope: string } }) {
  return NextResponse.json({ ok: true, channel: 'amojo', scope: params.scope });
}

export async function POST(req: NextRequest, { params }: { params: { scope: string } }) {
  const raw = await req.text();
  db.insert(kommoWebhookLog)
    .values({ body: { source: 'amojo', scope: params.scope, raw }, processed: false })
    .catch(() => {});
  // Kommo espera 200 rápido; el procesamiento real se hace async cuando esté listo.
  return NextResponse.json({ ok: true });
}

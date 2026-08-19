import { NextRequest, NextResponse } from 'next/server';
import { retryFailedEvents } from '@/lib/meta';

// Cron de reintentos de eventos CAPI fallidos.
// Configurar en Railway (Cron) apuntando a /api/cron/retry con el header
//   Authorization: Bearer <CRON_SECRET>
// Frecuencia sugerida: cada 10-15 min.
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const mustGate = !!secret || process.env.REQUIRE_CRON_SECRET === '1';
  if (!secret && process.env.NODE_ENV === 'production') {
    console.warn('[cron] CRON_SECRET ausente en prod (Fase 2.5). Setear + REQUIRE_CRON_SECRET=1 para cerrar.');
  }
  if (mustGate) {
    const auth = req.headers.get('authorization');
    if (!secret || auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'no autorizado' }, { status: 401 });
    }
  }
  const result = await retryFailedEvents();
  return NextResponse.json({ ok: true, ...result });
}

// Permitir GET para probar manualmente (mismo gate).
export const GET = POST;

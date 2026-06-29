import { NextRequest, NextResponse } from 'next/server';
import { retryFailedEvents } from '@/lib/meta';

// Cron de reintentos de eventos CAPI fallidos.
// Configurar en Railway (Cron) apuntando a /api/cron/retry con el header
//   Authorization: Bearer <CRON_SECRET>
// Frecuencia sugerida: cada 10-15 min.
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get('authorization');
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'no autorizado' }, { status: 401 });
    }
  }
  const result = await retryFailedEvents();
  return NextResponse.json({ ok: true, ...result });
}

// Permitir GET para probar manualmente (mismo gate).
export const GET = POST;

import { NextRequest, NextResponse } from 'next/server';
import { getTenantBySlug } from '@/lib/tenants';
import { sendCapiEvent } from '@/lib/meta';

// POST /api/test/capi?tenant=<slug>
// Manda un evento de prueba a Meta para validar contra Events Manager.
// Si META_TEST_EVENT_CODE está en .env, aparece en "Eventos de prueba".
export async function POST(req: NextRequest) {
  const slug = new URL(req.url).searchParams.get('tenant');
  if (!slug) return NextResponse.json({ error: 'tenant requerido' }, { status: 400 });

  const tenant = await getTenantBySlug(slug);
  if (!tenant) return NextResponse.json({ error: 'tenant desconocido' }, { status: 404 });

  const result = await sendCapiEvent(tenant, {
    eventName: 'Conversacion',
    eventId: `test-${Date.now()}`,
    userData: {
      // datos de prueba; en real vienen del lead
      clientIp: req.headers.get('x-forwarded-for')?.split(',')[0] ?? undefined,
      userAgent: req.headers.get('user-agent') ?? undefined,
    },
    customData: { campaign_id: 'TEST', internal_event: 'test' },
    actionSource: 'system_generated',
  });

  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}

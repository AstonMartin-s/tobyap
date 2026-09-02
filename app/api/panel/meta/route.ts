import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getTenantBySlug, updateTenantFields } from '@/lib/tenants';
import { NICHE_EVENTS, type EventSlot } from '@/lib/niche';

export const dynamic = 'force-dynamic';

// Nombre real del evento que se manda a Meta para una ranura lógica, según nicho
// (mismo criterio que lib/meta.ts fullEventName).
function eventNameFor(slot: EventSlot, niche: 'circo' | 'tienda', suffix: string): string {
  const ev = NICHE_EVENTS[niche]?.[slot];
  if (!ev) return slot;
  return ev.standard ? ev.base : `${ev.base}CRM${suffix}`;
}

// GET /api/panel/meta → pixel + estado del token + eventos que se envían (nicho-aware).
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no autenticado' }, { status: 401 });
  const t = await getTenantBySlug(session.slug);
  if (!t) return NextResponse.json({ error: 'no encontrado' }, { status: 404 });

  const suffix = t.eventSuffix ?? '';
  return NextResponse.json({
    niche: t.niche,
    pixelId: t.metaPixelId ?? '',
    hasToken: !!t.metaCapiToken,
    events: {
      conversation: eventNameFor('conversation', t.niche, suffix),
      conversion: eventNameFor('conversion', t.niche, suffix),
    },
  });
}

// PUT /api/panel/meta { pixelId?, capiToken? } → actualiza pixel/token (token cifrado).
export async function PUT(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no autenticado' }, { status: 401 });
  if (session.panelRole && session.panelRole !== 'admin') {
    return NextResponse.json({ error: 'sin permiso' }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as { pixelId?: string; capiToken?: string };
  const updates: { metaPixelId?: string; metaCapiToken?: string } = {};

  if (body.pixelId !== undefined) {
    const pid = body.pixelId.trim();
    if (pid && !/^\d{6,20}$/.test(pid)) {
      return NextResponse.json({ error: 'Pixel ID inválido (solo dígitos)' }, { status: 400 });
    }
    updates.metaPixelId = pid;
  }
  const token = (body.capiToken ?? '').trim();
  if (token) updates.metaCapiToken = token; // updateTenantFields lo cifra; vacío = no toca

  if (Object.keys(updates).length === 0) return NextResponse.json({ ok: true, unchanged: true });

  await updateTenantFields(session.slug, updates);
  return NextResponse.json({ ok: true });
}

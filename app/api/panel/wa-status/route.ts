import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getTenantBySlug } from '@/lib/tenants';
import { blasterConfig, blasterLineIds, blasterState, phoneFromJid, waMeLink, MAX_BLASTER_LINES } from '@/lib/blaster';

export const dynamic = 'force-dynamic';

type Cached = { at: number; payload: Record<string, unknown> };
const CACHE = new Map<string, Cached>();
const TTL_MS = 15000;

function linePayload(sessionId: string, state: Awaited<ReturnType<typeof blasterState>>) {
  const jid = state?.jid ?? null;
  return {
    sessionId,
    status: state?.status ?? 'unknown',
    jid,
    phone: phoneFromJid(jid),
    link: waMeLink(jid),
    lastError: state?.lastError ?? null,
    qr: state?.qr ?? null,
    device: state?.device ?? null,
    connectionStatus: state?.connectionStatus ?? null,
    authenticationStatus: state?.authenticationStatus ?? null,
    lastCausalEvent: state?.lastCausalEvent ?? null,
    sessionHealth: state?.sessionHealth ?? null,
  };
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no autenticado' }, { status: 401 });

  const fresh = req.nextUrl.searchParams.get('fresh') === '1';
  const cached = CACHE.get(session.tenantId);
  if (!fresh && cached && Date.now() - cached.at < TTL_MS) {
    return NextResponse.json(cached.payload);
  }

  const tenant = await getTenantBySlug(session.slug);
  const ids = tenant ? blasterLineIds(tenant) : [];
  if (!tenant || ids.length === 0) {
    const payload = { ok: true, enabled: false, max: MAX_BLASTER_LINES, lines: [] };
    CACHE.set(session.tenantId, { at: Date.now(), payload });
    return NextResponse.json(payload);
  }

  const lines = await Promise.all(ids.map(async (id) => {
    const cfg = blasterConfig(tenant, id);
    const state = cfg ? await blasterState(cfg) : null;
    return linePayload(id, state);
  }));

  const first = lines[0];
  const payload = {
    ok: true,
    enabled: true,
    max: MAX_BLASTER_LINES,
    lines,
    // Compat con el header (primera línea).
    status: first?.status ?? 'unknown',
    jid: first?.jid ?? null,
    lastError: first?.lastError ?? null,
    qr: first?.qr ?? null,
    device: first?.device ?? null,
    connectionStatus: first?.connectionStatus ?? null,
    authenticationStatus: first?.authenticationStatus ?? null,
    lastCausalEvent: first?.lastCausalEvent ?? null,
    sessionHealth: first?.sessionHealth ?? null,
  };
  CACHE.set(session.tenantId, { at: Date.now(), payload });
  return NextResponse.json(payload);
}

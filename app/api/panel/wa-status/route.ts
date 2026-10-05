import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getTenantBySlug } from '@/lib/tenants';
import { blasterConfig, blasterState } from '@/lib/blaster';

export const dynamic = 'force-dynamic';

type Cached = { at: number; payload: Record<string, unknown> };
const CACHE = new Map<string, Cached>();
const TTL_MS = 15000;

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no autenticado' }, { status: 401 });

  const fresh = req.nextUrl.searchParams.get('fresh') === '1';
  const cached = CACHE.get(session.tenantId);
  if (!fresh && cached && Date.now() - cached.at < TTL_MS) {
    return NextResponse.json(cached.payload);
  }

  const tenant = await getTenantBySlug(session.slug);
  const cfg = tenant ? blasterConfig(tenant) : null;
  if (!cfg) {
    const payload = { ok: true, enabled: false };
    CACHE.set(session.tenantId, { at: Date.now(), payload });
    return NextResponse.json(payload);
  }

  const state = await blasterState(cfg);
  const payload = state
    ? { ok: true, enabled: true, status: state.status, jid: state.jid ?? null, lastError: state.lastError ?? null, qr: state.qr ?? null }
    : { ok: true, enabled: true, status: 'unknown', jid: null, lastError: 'sin respuesta de Blaster', qr: null };
  CACHE.set(session.tenantId, { at: Date.now(), payload });
  return NextResponse.json(payload);
}

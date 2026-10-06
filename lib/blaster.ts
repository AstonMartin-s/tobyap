// Cliente HTTP hacia Blaster (WhatsApp no-API). Un tenant tiene canal solo si
// tiene blasterBaseUrl + blasterSessionId + blasterToken.
//
// Estado: GET /api/sessions/:id/state → SessionState (status, jid, device,
// connectionStatus, authenticationStatus, sessionHealth, lastError,
// lastCausalEvent, qr solo con contenido si status=qr). lineReputation no viene.
// Cuidado del número: authenticationStatus=revoked (LoggedOut, StreamReplaced,
// TemporaryBan, ClientOutdated, PairError). sessionHealth=reconnecting no es aviso.
// Más líneas (aún no): POST /api/sessions/tracker {label?, forwardUrl, forwardSecret}
// → {id, state}; guardar el id en el tenant. GET /api/sessions oculta trackers.
import type { ResolvedTenant } from '@/lib/types';

export interface BlasterConfig {
  baseUrl: string;
  sessionId: string;
  token: string;
}

export function blasterConfig(tenant: ResolvedTenant): BlasterConfig | null {
  const baseUrl = (tenant.blasterBaseUrl ?? '').trim().replace(/\/+$/, '');
  const sessionId = (tenant.blasterSessionId ?? '').trim();
  const token = (tenant.blasterToken ?? '').trim();
  if (!baseUrl || !sessionId || !token) return null;
  return { baseUrl, sessionId, token };
}

export function hasWhatsappChannel(tenant: ResolvedTenant): boolean {
  return blasterConfig(tenant) !== null;
}

async function call(cfg: BlasterConfig, path: string, init: RequestInit, timeoutMs = 10000): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(`${cfg.baseUrl}${path}`, {
      ...init,
      signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        ...(init.headers ?? {}),
      },
      cache: 'no-store',
    });
  } finally {
    clearTimeout(t);
  }
}

export async function blasterSendText(cfg: BlasterConfig, to: string, text: string): Promise<{ ok: boolean; id?: string; error?: string }> {
  try {
    const r = await call(cfg, `/api/sessions/${encodeURIComponent(cfg.sessionId)}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, text }),
    });
    if (!r.ok) return { ok: false, error: `blaster ${r.status}` };
    const d = (await r.json().catch(() => ({}))) as { id?: string };
    return { ok: true, id: typeof d.id === 'string' ? d.id : undefined };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export interface BlasterState {
  status: string;
  jid?: string | null;
  lastError?: string | null;
  qr?: string | null;
  device?: string | null;
  connectionStatus?: string | null;
  authenticationStatus?: string | null;
  lastCausalEvent?: string | null;
  sessionHealth?: string | null;
}

function strOrNull(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v : null;
}

export async function blasterState(cfg: BlasterConfig): Promise<BlasterState | null> {
  try {
    const r = await call(cfg, `/api/sessions/${encodeURIComponent(cfg.sessionId)}/state`, { method: 'GET' }, 8000);
    if (!r.ok) return null;
    const d = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    return {
      status: typeof d.status === 'string' ? d.status : 'unknown',
      jid: strOrNull(d.jid),
      lastError: strOrNull(d.lastError),
      qr: strOrNull(d.qr),
      device: strOrNull(d.device),
      connectionStatus: strOrNull(d.connectionStatus),
      authenticationStatus: strOrNull(d.authenticationStatus),
      lastCausalEvent: strOrNull(d.lastCausalEvent),
      sessionHealth: strOrNull(d.sessionHealth),
    };
  } catch {
    return null;
  }
}

export async function blasterConnect(cfg: BlasterConfig): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await call(cfg, `/api/sessions/${encodeURIComponent(cfg.sessionId)}/connect`, { method: 'POST' }, 12000);
    if (!r.ok) return { ok: false, error: `blaster ${r.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

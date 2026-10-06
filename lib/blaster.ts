// Cliente HTTP hacia Blaster (WhatsApp no-API). Un tenant tiene canal solo si
// tiene blasterBaseUrl + blasterToken + al menos un session id.
//
// Estado: GET /api/sessions/:id/state → SessionState (status, jid, device,
// connectionStatus, authenticationStatus, sessionHealth, lastError,
// lastCausalEvent, qr solo con contenido si status=qr). lineReputation no viene.
// Cuidado del número: authenticationStatus=revoked (LoggedOut, StreamReplaced,
// TemporaryBan, ClientOutdated, PairError). sessionHealth=reconnecting no es aviso.
// Más líneas: POST /api/sessions/tracker {label?, forwardUrl, forwardSecret}
// → {id, state}; guardar el id en el tenant (máx. 5). GET /api/sessions oculta trackers.
import type { ResolvedTenant } from '@/lib/types';

export const MAX_BLASTER_LINES = 5;

export interface BlasterConfig {
  baseUrl: string;
  sessionId: string;
  token: string;
}

export interface BlasterAuth {
  baseUrl: string;
  token: string;
}

export function blasterAuth(tenant: ResolvedTenant): BlasterAuth | null {
  const baseUrl = (tenant.blasterBaseUrl ?? '').trim().replace(/\/+$/, '');
  const token = (tenant.blasterToken ?? '').trim();
  if (!baseUrl || !token) return null;
  return { baseUrl, token };
}

export function blasterLineIds(tenant: ResolvedTenant): string[] {
  const extra = tenant.blasterSessionIds ?? [];
  const all = [tenant.blasterSessionId, ...extra]
    .map((s) => (typeof s === 'string' ? s.trim() : ''))
    .filter(Boolean);
  return [...new Set(all)].slice(0, MAX_BLASTER_LINES);
}

export function blasterConfig(tenant: ResolvedTenant, sessionId?: string): BlasterConfig | null {
  const auth = blasterAuth(tenant);
  const ids = blasterLineIds(tenant);
  const id = (sessionId ?? ids[0] ?? '').trim();
  if (!auth || !id) return null;
  if (sessionId && !ids.includes(sessionId)) return null;
  return { baseUrl: auth.baseUrl, token: auth.token, sessionId: id };
}

export function hasWhatsappChannel(tenant: ResolvedTenant): boolean {
  return blasterConfig(tenant) !== null;
}

export function waMeLink(jidOrPhone?: string | null): string | null {
  if (!jidOrPhone) return null;
  const digits = jidOrPhone.split('@')[0].split(':')[0].replace(/\D/g, '');
  return digits.length >= 8 ? `https://wa.me/${digits}` : null;
}

export function phoneFromJid(jid?: string | null): string | null {
  if (!jid) return null;
  const digits = jid.split('@')[0].split(':')[0].replace(/\D/g, '');
  return digits ? `+${digits}` : null;
}

async function call(cfg: BlasterAuth, path: string, init: RequestInit, timeoutMs = 10000): Promise<Response> {
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

function parseState(d: Record<string, unknown>): BlasterState {
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
}

export async function blasterState(cfg: BlasterConfig): Promise<BlasterState | null> {
  try {
    const r = await call(cfg, `/api/sessions/${encodeURIComponent(cfg.sessionId)}/state`, { method: 'GET' }, 8000);
    if (!r.ok) return null;
    const d = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    return parseState(d);
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

export async function blasterCreateTracker(
  auth: BlasterAuth,
  body: { label?: string; forwardUrl: string; forwardSecret: string },
): Promise<{ id: string; state: BlasterState | null } | { error: string }> {
  try {
    const r = await call(auth, '/api/sessions/tracker', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }, 15000);
    const d = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    if (!r.ok) return { error: `blaster ${r.status}` };
    const id = typeof d.id === 'string' ? d.id.trim() : '';
    if (!id) return { error: 'blaster no devolvió id' };
    const rawState = d.state && typeof d.state === 'object' ? d.state as Record<string, unknown> : null;
    return { id, state: rawState ? parseState(rawState) : null };
  } catch (e) {
    return { error: String(e) };
  }
}

export function appPublicUrl(): string {
  return (process.env.APP_PUBLIC_URL ?? 'https://tobyap-production.up.railway.app').replace(/\/+$/, '');
}

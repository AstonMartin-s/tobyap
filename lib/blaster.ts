// Cliente HTTP hacia Blaster (servicio externo de WhatsApp no-API). Un tenant tiene
// canal WhatsApp SOLO si tiene blasterBaseUrl + blasterSessionId + blasterToken.
// TOBYAP opera la sesión (kind:'tracker', oculta del panel de Blaster) con un token
// de máquina propio. Nada de esto toca el motor de blast de Blaster.
import type { ResolvedTenant } from '@/lib/types';

export interface BlasterConfig {
  baseUrl: string;
  sessionId: string;
  token: string;
}

// Devuelve la config de Blaster del tenant o null si el canal WhatsApp no está activo.
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

// Envío 1:1 de texto. Devuelve el message_id de Blaster (o null si falló).
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
  status: string; // 'connected'|'reconnecting'|'disconnected'|...
  jid?: string | null;
  lastError?: string | null;
}

export async function blasterState(cfg: BlasterConfig): Promise<BlasterState | null> {
  try {
    const r = await call(cfg, `/api/sessions/${encodeURIComponent(cfg.sessionId)}/state`, { method: 'GET' }, 8000);
    if (!r.ok) return null;
    const d = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    return {
      status: typeof d.status === 'string' ? d.status : 'unknown',
      jid: typeof d.jid === 'string' ? d.jid : null,
      lastError: typeof d.lastError === 'string' ? d.lastError : null,
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

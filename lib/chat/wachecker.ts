// wachecker — verifica que el número exista en WhatsApp a través de la API del
// BLASTER (`POST /api/wa/check`), que envuelve WuzAPI y elige una sesión conectada.
// Si no está configurado o no hay sesión, cae a validación de formato (no bloquea,
// marca waVerified=false).
//
// Env: WACHECK_URL (ej https://api-production-be91.up.railway.app/api/wa/check)
//      WACHECK_TOKEN (Bearer estático, server-to-server).

export function normalizePhone(raw: string): string {
  return (raw ?? '').replace(/[^\d]/g, '');
}

// Formato AR: 54 9 <área> <número>, total ~13 dígitos (54 + 11 díg). Aceptamos
// también sin el 9 y normalizamos a 549...
export function normalizeAr(raw: string): string {
  let d = normalizePhone(raw);
  if (d.startsWith('00')) d = d.slice(2);
  if (!d.startsWith('54')) d = '54' + d;
  // Insertar el 9 de celular si falta (54 -> 549) cuando corresponde.
  if (d.startsWith('54') && !d.startsWith('549')) d = '549' + d.slice(2);
  return d;
}

export function isPlausibleAr(raw: string): boolean {
  const d = normalizeAr(raw);
  return d.length >= 12 && d.length <= 14; // 549 + 10 díg aprox
}

export interface WaCheckResult {
  ok: boolean;          // pasa el gate (formato válido y —si hay wuzapi— existe en WA)
  onWhatsApp: boolean | null; // true/false si se verificó; null si no se pudo
  phone: string;        // normalizado
  reason?: string;
}

export async function checkWhatsApp(raw: string): Promise<WaCheckResult> {
  const phone = normalizeAr(raw);
  if (!isPlausibleAr(raw)) {
    return { ok: false, onWhatsApp: null, phone, reason: 'formato inválido' };
  }
  const url = process.env.WACHECK_URL;
  const token = process.env.WACHECK_TOKEN;
  if (!url || !token) {
    // Sin gateway configurado: dejamos pasar por formato, sin verificar WA.
    return { ok: true, onWhatsApp: null, phone, reason: 'wa-check no configurado' };
  }
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ phone }),
    });
    // Fallbacks que NO deben bloquear al usuario (problemas de infra, no del número):
    // sin sesión conectada, rate-limit, o errores del gateway → pasa por formato.
    if (res.status === 503 || res.status === 429 || res.status === 502) {
      return { ok: true, onWhatsApp: null, phone, reason: `wa-check ${res.status}` };
    }
    const j = (await res.json().catch(() => ({}))) as { onWhatsApp?: boolean; phone?: string };
    if (res.status === 400) return { ok: false, onWhatsApp: null, phone, reason: 'formato inválido' };
    if (!res.ok) return { ok: true, onWhatsApp: null, phone, reason: `wa-check ${res.status}` };
    const on = Boolean(j.onWhatsApp);
    return { ok: on, onWhatsApp: on, phone: j.phone || phone, reason: on ? undefined : 'sin WhatsApp' };
  } catch {
    return { ok: true, onWhatsApp: null, phone, reason: 'wa-check error' };
  }
}

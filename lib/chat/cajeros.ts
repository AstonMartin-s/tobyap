// Cajeros con CBU/WhatsApp propios y rotación por horario (Imperio VIP y quien
// lo necesite). La config vive en clientSettings.chatConfig.cajeros (+ cajerosTz).
// A una hora dada se muestra el CBU y se deriva al WhatsApp del cajero cuyo
// horario cubre ese momento (hora local AR). Si ninguno cubre, cae al cajero
// marcado fallback (o al primero). Es ADITIVO: sin cajeros, el flujo no cambia.

export interface CajeroWindow {
  from: string; // "HH:MM"
  to: string;   // "HH:MM" — "24:00" = fin del día
}
export interface CajeroConf {
  id: string;
  label: string;
  cbu: string;
  titular: string;
  wa: string;
  schedule: CajeroWindow[];
  fallback?: boolean;
}

export const DEFAULT_CAJEROS_TZ = 'America/Argentina/Buenos_Aires';

function asStr(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}

/** Lee y normaliza los cajeros del chatConfig. */
export function getCajeros(chatConfig: unknown): CajeroConf[] {
  const cc = chatConfig && typeof chatConfig === 'object' && !Array.isArray(chatConfig)
    ? (chatConfig as Record<string, unknown>) : {};
  const raw = Array.isArray(cc.cajeros) ? cc.cajeros : [];
  return raw
    .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
    .map((c, i) => ({
      id: asStr(c.id) || `c${i + 1}`,
      label: asStr(c.label) || `Cajero ${i + 1}`,
      cbu: asStr(c.cbu),
      titular: asStr(c.titular),
      wa: asStr(c.wa),
      schedule: Array.isArray(c.schedule)
        ? c.schedule
            .filter((w): w is Record<string, unknown> => !!w && typeof w === 'object')
            .map((w) => ({ from: asStr(w.from), to: asStr(w.to) }))
            .filter((w) => w.from && w.to)
        : [],
      fallback: c.fallback === true,
    }));
}

export function getCajerosTz(chatConfig: unknown): string {
  const cc = chatConfig && typeof chatConfig === 'object' && !Array.isArray(chatConfig)
    ? (chatConfig as Record<string, unknown>) : {};
  const tz = asStr(cc.cajerosTz);
  return tz || DEFAULT_CAJEROS_TZ;
}

function toMinutes(hhmm: string): number {
  const [h, m] = asStr(hhmm).split(':');
  return (Number(h) || 0) * 60 + (Number(m) || 0);
}

/** Minutos desde medianoche en la hora local de `tz`. */
function nowMinutesInTz(tz: string, nowMs?: number): number {
  const d = new Date(nowMs ?? Date.now());
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(d);
    const h = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
    const m = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
    return (h % 24) * 60 + m;
  } catch {
    return d.getUTCHours() * 60 + d.getUTCMinutes();
  }
}

function inWindow(nowMin: number, w: CajeroWindow): boolean {
  const a = toMinutes(w.from);
  const b = toMinutes(w.to);
  if (a === b) return false;
  if (a < b) return nowMin >= a && nowMin < b;   // franja normal
  return nowMin >= a || nowMin < b;              // cruza medianoche
}

/** Devuelve el cajero activo para la hora actual (o fallback / primero). */
export function pickActiveCajero(
  cajeros: CajeroConf[],
  tz: string = DEFAULT_CAJEROS_TZ,
  nowMs?: number,
): CajeroConf | null {
  if (!cajeros.length) return null;
  const nowMin = nowMinutesInTz(tz, nowMs);
  for (const c of cajeros) {
    if (c.schedule.some((w) => inWindow(nowMin, w))) return c;
  }
  return cajeros.find((c) => c.fallback) ?? cajeros[0];
}

/** Sticky por sesión: si el cliente YA entró bajo un cajero (`prevCajeroId`), se
 *  lo mantiene en ese cajero (leyendo sus datos actuales del config, por si se
 *  editó el CBU/WhatsApp). Solo en la PRIMERA asignación se elige por horario.
 *  Si el cajero fijado ya no existe, cae a la selección por horario. */
export function pickStickyCajero(
  cajeros: CajeroConf[],
  tz: string = DEFAULT_CAJEROS_TZ,
  prevCajeroId?: string | null,
  nowMs?: number,
): CajeroConf | null {
  if (!cajeros.length) return null;
  if (prevCajeroId) {
    const stuck = cajeros.find((c) => c.id === prevCajeroId);
    if (stuck) return stuck;
  }
  return pickActiveCajero(cajeros, tz, nowMs);
}

// Usuario sugerido para el alta MANUAL. Puro: lo usan el flujo y el panel.

const GANAMOS_CODES = ['777', '888', '222', '123'] as const;

export function cleanManualBase(name?: string | null, phone?: string): string {
  const clean = (name ?? '')
    .normalize('NFD')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase()
    .slice(0, 12);
  const digits = (phone ?? '').replace(/\D/g, '');
  return clean.length >= 2 ? clean : `user${digits.slice(-6)}`;
}

/** GoldenC / ElGanador: nombre limpio + últimos 4 del teléfono. */
export function buildPhoneUsername(name?: string | null, phone?: string): string {
  const digits = (phone ?? '').replace(/\D/g, '');
  return `${cleanManualBase(name, phone)}${digits.slice(-4)}`.slice(0, 18);
}

/**
 * ClienteA1 (Ganamos): nombre + un código de 3 (777/888/222/123) + "g".
 * El código sale del teléfono para que la misma persona reciba siempre el
 * mismo, y rota al siguiente si ese usuario ya está tomado.
 */
export function buildGanamosUsername(name?: string | null, phone?: string, taken?: Iterable<string>): string {
  const base = cleanManualBase(name, phone);
  const digits = (phone ?? '').replace(/\D/g, '');
  const start = Number(digits.slice(-2) || '0') % GANAMOS_CODES.length;
  const used = new Set(Array.from(taken ?? [], (s) => String(s).toLowerCase()));
  for (let i = 0; i < GANAMOS_CODES.length; i++) {
    const u = `${base}${GANAMOS_CODES[(start + i) % GANAMOS_CODES.length]}g`.slice(0, 18);
    if (!used.has(u)) return u;
  }
  const extra = digits.slice(-1) || '9';
  return `${base}${GANAMOS_CODES[start]}${extra}g`.slice(0, 18);
}

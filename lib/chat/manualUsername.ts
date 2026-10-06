// Usuario sugerido para el alta MANUAL. Puro: lo usan el flujo y el panel.

const GANAMOS_CODES = ['777', '888', '222', '123'] as const;

/** Contraseña fácil de dictar: 3 letras iguales + 3 números iguales. Ej: aaa777.
 *  Sin i, l, o, 0 ni 1, que se confunden al leer. */
export function easyPlayerPassword(): string {
  const letters = 'abcdefghjkmnpqrstuvwxyz';
  const digits = '23456789';
  const l = letters[Math.floor(Math.random() * letters.length)];
  const d = digits[Math.floor(Math.random() * digits.length)];
  return `${l}${l}${l}${d}${d}${d}`;
}

export function cleanManualBase(name?: string | null, phone?: string): string {
  const clean = (name ?? '')
    .normalize('NFD')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase()
    .slice(0, 12);
  if (clean.length >= 2) return clean;
  const digits = (phone ?? '').replace(/\D/g, '');
  return digits ? `user${digits.slice(-6)}` : 'jugador';
}

/** ClienteA1: solo letras del nombre. Sin dígitos del teléfono. */
function ganamosNameBase(name?: string | null): string {
  const clean = (name ?? '')
    .normalize('NFD')
    .replace(/[^a-zA-Z]/g, '')
    .toLowerCase()
    .slice(0, 12);
  return clean.length >= 2 ? clean : 'jugador';
}

/** GoldenC / ElGanador: nombre limpio + últimos 4 del teléfono. */
export function buildPhoneUsername(name?: string | null, phone?: string): string {
  const digits = (phone ?? '').replace(/\D/g, '');
  return `${cleanManualBase(name, phone)}${digits.slice(-4)}`.slice(0, 18);
}

/**
 * ClienteA1 (Ganamos): solo el nombre + 777/888/222/123 + "g".
 * Sin dígitos del teléfono. Empieza en 777; si está tomado, rota.
 */
export function buildGanamosUsername(name?: string | null, _phone?: string, taken?: Iterable<string>): string {
  const base = ganamosNameBase(name);
  const used = new Set(Array.from(taken ?? [], (s) => String(s).toLowerCase()));
  for (const code of GANAMOS_CODES) {
    const u = `${base}${code}g`.slice(0, 18);
    if (!used.has(u)) return u;
  }
  return `${base}${GANAMOS_CODES[0]}9g`.slice(0, 18);
}

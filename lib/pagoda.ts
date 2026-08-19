import type { ResolvedTenant } from '@/lib/types';

// ---------------------------------------------------------------------------
// Pagoda (dat4win) — creación de cuentas de portal.
//
// El bot deriva el lead y en vez de crear el usuario a mano, pedimos una cuenta
// a la app del cliente. Pagoda genera usuario/clave y devuelve un magic-link
// (login_url) de un solo uso. Es idempotente por teléfono: si ya existía, la
// reconoce (no duplica).
// ---------------------------------------------------------------------------

const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
const randLetter = () => LETTERS[Math.floor(Math.random() * LETTERS.length)];
const randLetters = (n: number) => Array.from({ length: n }, randLetter).join('');

// Construye el "name" que mandamos a Pagoda a partir del nombre de WhatsApp del
// lead. Regla: primeros 5 caracteres alfabéticos del nombre (si quedan menos de
// 3 usables, se completa con letras al azar) + 1 dígito al azar. Pagoda le agrega
// su propio sufijo de 3 dígitos, así que nosotros no ponemos más que eso.
// Ej: "Kingstore w45" -> "Kings4" -> Pagoda devuelve "kings4383".
export function buildPortalName(rawName?: string | null): string {
  // Sacamos acentos y dejamos solo letras a-z (sin números/emojis/símbolos).
  // NFD separa el acento en marca combinante; [^a-zA-Z] la descarta junto con
  // emojis, números, espacios y símbolos. "Damián 🎰" -> "Damian".
  const clean = (rawName ?? '').normalize('NFD').replace(/[^a-zA-Z]/g, '');
  let base = clean.slice(0, 5);
  if (base.length < 3) base += randLetters(3 - base.length);
  const digit = Math.floor(Math.random() * 10); // 1 dígito
  return `${base}${digit}`;
}

export interface PortalAccount {
  loginUrl: string | null;
  username: string | null;
  password: string | null;
  existing: boolean;
  raw: unknown;
}

export async function createPortalAccount(
  tenant: ResolvedTenant,
  input: { phone: string; name?: string | null },
): Promise<PortalAccount> {
  if (!tenant.pagodaUrl || !tenant.pagodaApiKey) {
    throw new Error(`tenant ${tenant.slug} sin pagodaUrl / pagodaApiKey`);
  }
  const url = `${tenant.pagodaUrl.replace(/\/$/, '')}/api/integrations/create-portal-account`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tenant.pagodaApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ phone: input.phone, name: input.name ?? undefined }),
  });
  const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(`pagoda ${res.status}: ${JSON.stringify(j).slice(0, 200)}`);
  }
  // Toleramos variantes de nombres en la respuesta.
  const pick = (...ks: string[]) => {
    for (const k of ks) {
      const v = j[k];
      if (typeof v === 'string' && v) return v;
    }
    return null;
  };
  return {
    loginUrl: pick('login_url', 'loginUrl', 'magic_link', 'url'),
    username: pick('username', 'user', 'usuario'),
    password: pick('password', 'pass', 'clave'),
    existing: j.existing === true || j.already_exists === true,
    raw: j,
  };
}

// ===========================================================================
// MÓDULO AISLADO A3 — configuración de las líneas WhatsApp BM (Pagoda).
// Todo se lee de env (A3_LINES = JSON). Sin secretos en el código.
// No importa nada del circuito viejo.
// ===========================================================================

export interface A3Line {
  key: string; // slug de la línea, usado en la URL del webhook (/api/a3/webhook/<key>)
  waNumber: string; // E.164 solo dígitos, para el wa.me de la landing
  phoneNumberId: string; // Meta phone_number_id
  verifyToken: string; // el que configuramos en Meta para verificar ESTE webhook
  // Modelo por defecto: 2da Meta App suscrita a la WABA → Meta manda a las dos
  // apps en paralelo, NO reenviamos (Pagoda recibe su copia directo).
  // Solo si forward=true (modelo relay: re-apuntamos el webhook a TOBYAP)
  // reenviamos el body crudo a pagodaWebhookUrl.
  forward?: boolean;
  pagodaWebhookUrl?: string; // solo se usa si forward=true
}

// A3_LINES: JSON array. Ej:
// [{"key":"sri","waNumber":"5491124892429","phoneNumberId":"1275589308963267",
//   "pagodaWebhookUrl":"https://pagoda.dat4win.com/api/wa/webhook?line_id=475409a4-00fa-4417-87ce-941d194edecb",
//   "verifyToken":"<token-que-ponemos-en-meta>"}, {...}]
export function a3Lines(): A3Line[] {
  try {
    const raw = process.env.A3_LINES;
    if (!raw) return [];
    const arr = JSON.parse(raw) as A3Line[];
    return Array.isArray(arr) ? arr.filter((l) => l.key && l.waNumber) : [];
  } catch {
    return [];
  }
}

export function a3LineByKey(key: string): A3Line | null {
  return a3Lines().find((l) => l.key === key) ?? null;
}

// Ruteo por phone_number_id (para el modelo de UNA app TOBYAP suscrita a las 2
// líneas: Meta manda todo a una URL y distinguimos por el número).
export function a3LineByPhoneNumberId(id?: string | null): A3Line | null {
  if (!id) return null;
  return a3Lines().find((l) => l.phoneNumberId === id) ?? null;
}

// Verify token global (una app) — si está seteado, sirve para verificar cualquier
// línea. Si no, se usa el verifyToken por línea.
export function a3VerifyToken(): string | null {
  return process.env.A3_VERIFY_TOKEN ?? null;
}

// Marcador de campaña en el texto pre-cargado: [C1] -> "C1".
export const A3_CAMPAIGN_MARKER = /\[([A-Za-z0-9_-]{1,24})\]/;

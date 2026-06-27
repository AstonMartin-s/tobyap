import crypto from 'crypto';
import { cookies } from 'next/headers';

// ---------------------------------------------------------------------------
// Sesión del panel: cookie firmada con HMAC-SHA256 (no cifrada, solo firmada;
// no guardamos secretos adentro, solo tenantId/slug). Formato: <body>.<sig>.
// ---------------------------------------------------------------------------

const COOKIE = 'tobyap_session';
const MAX_AGE = 60 * 60 * 8; // 8 horas

interface SessionData {
  tenantId: string;
  slug: string;
  role: string; // 'client' | 'admin'
  exp: number; // epoch segundos
}

function secret(): Buffer {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error('SESSION_SECRET no definida');
  return Buffer.from(s, 'utf8');
}

function sign(body: string): string {
  return crypto.createHmac('sha256', secret()).update(body).digest('base64url');
}

export function createSessionToken(data: Omit<SessionData, 'exp'>): string {
  const payload: SessionData = { ...data, exp: Math.floor(Date.now() / 1000) + MAX_AGE };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${sign(body)}`;
}

export function verifySessionToken(token: string | undefined): SessionData | null {
  if (!token) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  // comparación en tiempo constante
  const expected = sign(body);
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionData;
    if (data.exp < Math.floor(Date.now() / 1000)) return null;
    return data;
  } catch {
    return null;
  }
}

export async function setSession(data: Omit<SessionData, 'exp'>) {
  cookies().set(COOKIE, createSessionToken(data), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: MAX_AGE,
  });
}

export async function clearSession() {
  cookies().delete(COOKIE);
}

export async function getSession(): Promise<SessionData | null> {
  return verifySessionToken(cookies().get(COOKIE)?.value);
}

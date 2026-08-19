import crypto from 'crypto';

// HMAC corta vida para /api/chat/[slug]/file (notas Kommo).
// URLs viejas con solo sessionKey: FILE_LEGACY_DAYS (default 14).

function signingSecret(): string {
  return process.env.FILE_SIGNING_SECRET || process.env.SESSION_SECRET || '';
}

export function fileTokenTtlSec(): number {
  const n = Number(process.env.FILE_TOKEN_TTL_SEC ?? 48 * 3600);
  return Number.isFinite(n) && n > 0 ? n : 48 * 3600;
}

export function fileLegacyDays(): number {
  const n = Number(process.env.FILE_LEGACY_DAYS ?? 14);
  return Number.isFinite(n) && n >= 0 ? n : 14;
}

function hmac(payload: string): string {
  const s = signingSecret();
  if (!s) return '';
  return crypto.createHmac('sha256', s).update(payload).digest('base64url');
}

export function signFilePath(slug: string, sessionKey: string): string {
  const base = `/api/chat/${slug}/file?sessionKey=${encodeURIComponent(sessionKey)}`;
  const secret = signingSecret();
  if (!secret) return base;
  const exp = Math.floor(Date.now() / 1000) + fileTokenTtlSec();
  const t = hmac(`${slug}\n${sessionKey}\n${exp}`);
  return `${base}&e=${exp}&t=${t}`;
}

export function verifyFileToken(slug: string, sessionKey: string, expRaw: string | null, token: string | null): boolean {
  if (!expRaw || !token || !signingSecret()) return false;
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;
  const expected = hmac(`${slug}\n${sessionKey}\n${exp}`);
  if (!expected || expected.length !== token.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(token));
  } catch {
    return false;
  }
}

export function withinLegacyWindow(fromMs: number | null | undefined): boolean {
  const days = fileLegacyDays();
  if (days <= 0) return false;
  if (!fromMs || !Number.isFinite(fromMs)) return false;
  return Date.now() - fromMs <= days * 86_400_000;
}

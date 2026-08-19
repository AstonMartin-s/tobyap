import type { NextRequest } from 'next/server';

// Rate limit in-memory (1 réplica Railway). Soft 429. RATE_LIMIT=0 lo apaga.

type Bucket = { n: number; resetAt: number };
const buckets = new Map<string, Bucket>();

function prune(now: number) {
  if (buckets.size < 4000) return;
  for (const [k, b] of buckets) {
    if (now >= b.resetAt) buckets.delete(k);
  }
}

export function clientIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown'
  );
}

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): { ok: true } | { ok: false; retryAfterSec: number } {
  if (process.env.RATE_LIMIT === '0' || limit <= 0) return { ok: true };
  const now = Date.now();
  prune(now);
  const cur = buckets.get(key);
  if (!cur || now >= cur.resetAt) {
    buckets.set(key, { n: 1, resetAt: now + windowMs });
    return { ok: true };
  }
  if (cur.n >= limit) {
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((cur.resetAt - now) / 1000)) };
  }
  cur.n += 1;
  return { ok: true };
}

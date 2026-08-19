import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';

// Opt-in por tenant. Env: KOMMO_WEBHOOK_SECRET_<SLUG> (guiones → _).
// Kommo: misma URL + ?secret=...  GET de validación NO exige secret.

function envKey(slug: string): string {
  return `KOMMO_WEBHOOK_SECRET_${slug.replace(/-/g, '_').toUpperCase()}`;
}

export function kommoWebhookSecret(slug: string): string | undefined {
  const v = process.env[envKey(slug)];
  return v || undefined;
}

function secretsEqual(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

export function assertKommoWebhookSecret(req: NextRequest, slug: string): NextResponse | null {
  const expected = kommoWebhookSecret(slug);
  if (!expected) return null;
  const got = req.nextUrl.searchParams.get('secret') ?? req.headers.get('x-webhook-secret') ?? '';
  if (!got || !secretsEqual(got, expected)) {
    return NextResponse.json({ error: 'webhook no autorizado' }, { status: 401 });
  }
  return null;
}

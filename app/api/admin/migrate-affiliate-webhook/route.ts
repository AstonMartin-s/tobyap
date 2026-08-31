import { NextRequest, NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { isAdmin } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';

// POST /api/admin/migrate-affiliate-webhook
// Agrega la columna cifrada `affiliate_webhook_secret` a tenants (idempotente).
// Secreto compartido para firmar (HMAC-SHA256) el webhook de afiliados Telegram.
export async function POST(req: NextRequest) {
  if (!(await isAdmin(req))) {
    return NextResponse.json({ error: 'no autorizado' }, { status: 403 });
  }

  await db.execute(sql`
    ALTER TABLE tenants ADD COLUMN IF NOT EXISTS affiliate_webhook_secret TEXT
  `);

  return NextResponse.json({ ok: true });
}

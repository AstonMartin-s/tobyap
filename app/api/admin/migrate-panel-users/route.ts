import { NextRequest, NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { isAdmin } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (!(await isAdmin(req))) {
    return NextResponse.json({ error: 'no autorizado' }, { status: 403 });
  }

  // 1. Create the table if it doesn't exist
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS panel_users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      username TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      display_name TEXT,
      role TEXT NOT NULL DEFAULT 'operador',
      active BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    )
  `);

  // 2. Find tenants that don't have an admin in panel_users yet
  const candidates = await db.execute(sql`
    SELECT id, panel_user, panel_password_hash, name, active
    FROM tenants
    WHERE panel_user IS NOT NULL
      AND panel_password_hash IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM panel_users pu
        WHERE pu.tenant_id = tenants.id AND pu.role = 'admin'
      )
  `);

  let migrated = 0;
  for (const t of candidates as Array<Record<string, unknown>>) {
    await db.execute(sql`
      INSERT INTO panel_users (tenant_id, username, password_hash, display_name, role, active)
      VALUES (${t.id}, ${t.panel_user}, ${t.panel_password_hash}, ${t.name}, 'admin', ${t.active})
    `);
    migrated++;
  }

  return NextResponse.json({ ok: true, migrated, total_candidates: (candidates as unknown[]).length });
}

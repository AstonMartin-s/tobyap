import { NextRequest, NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { a3Conversations } from '@/db/schema';
import { isAdmin } from '@/lib/admin-auth';

// GET /api/a3/stats — conversaciones medidas del módulo A3 (total, por campaña,
// por línea y por día). Solo lectura de la tabla a3_conversations.
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!(await isAdmin(req))) return NextResponse.json({ error: 'no autorizado' }, { status: 401 });

  const [total] = await db.select({ n: sql<number>`count(*)::int` }).from(a3Conversations);
  const byCampaign = await db
    .select({ campaign: a3Conversations.campaign, n: sql<number>`count(*)::int` })
    .from(a3Conversations)
    .groupBy(a3Conversations.campaign);
  const byLine = await db
    .select({ line: a3Conversations.line, n: sql<number>`count(*)::int` })
    .from(a3Conversations)
    .groupBy(a3Conversations.line);
  const byDay = await db
    .select({
      day: sql<string>`to_char(${a3Conversations.createdAt} at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD')`,
      n: sql<number>`count(*)::int`,
    })
    .from(a3Conversations)
    .groupBy(sql`1`)
    .orderBy(sql`1 desc`);

  return NextResponse.json({ total: total.n, byCampaign, byLine, byDay });
}

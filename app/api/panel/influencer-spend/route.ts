import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq, gte, lte } from 'drizzle-orm';
import { db } from '@/db';
import { influencerSpend } from '@/db/schema';
import { getSession, isPanelAdmin } from '@/lib/session';
import { campaignChannel } from '@/lib/reports';

export const dynamic = 'force-dynamic';

// GET /api/panel/influencer-spend?start=&end= — lista de gastos del canal
// influencer del tenant (solo admin). Caja aparte: NO toca ledger/saldo.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no autorizado' }, { status: 401 });
  if (!isPanelAdmin(session.panelRole)) return NextResponse.json({ error: 'solo admin' }, { status: 403 });

  const start = req.nextUrl.searchParams.get('start') || undefined;
  const end = req.nextUrl.searchParams.get('end') || undefined;
  const conds = [eq(influencerSpend.tenantId, session.tenantId)];
  if (start) conds.push(gte(influencerSpend.day, start));
  if (end) conds.push(lte(influencerSpend.day, end));

  const rows = await db
    .select()
    .from(influencerSpend)
    .where(and(...conds))
    .orderBy(desc(influencerSpend.day));

  return NextResponse.json({ ok: true, rows });
}

// POST /api/panel/influencer-spend — upsert de gasto por (campaña, día).
// body: { campaign, day 'YYYY-MM-DD', amount, note? }. Solo admin.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no autorizado' }, { status: 401 });
  if (!isPanelAdmin(session.panelRole)) return NextResponse.json({ error: 'solo admin' }, { status: 403 });

  const b = (await req.json().catch(() => ({}))) as { campaign?: string; day?: string; amount?: number; note?: string };
  const campaign = (b.campaign ?? '').trim();
  const day = (b.day ?? '').trim();
  if (!campaign || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return NextResponse.json({ error: 'campaña y fecha (YYYY-MM-DD) requeridas' }, { status: 400 });
  }
  // Guardrail: el canal influencer se detecta por prefijo. Avisamos si no matchea
  // para que no carguen gasto de Meta acá por error.
  if (campaignChannel(campaign) !== 'influencer') {
    return NextResponse.json({ error: 'la campaña debe empezar con INFLU (ej. INFLUjuan)' }, { status: 400 });
  }
  const amount = Number(b.amount);
  if (!Number.isFinite(amount) || amount < 0) {
    return NextResponse.json({ error: 'monto inválido' }, { status: 400 });
  }

  await db
    .insert(influencerSpend)
    .values({ tenantId: session.tenantId, campaign, day, amount, note: b.note ?? null, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [influencerSpend.tenantId, influencerSpend.campaign, influencerSpend.day],
      set: { amount, note: b.note ?? null, updatedAt: new Date() },
    });

  return NextResponse.json({ ok: true });
}

// DELETE /api/panel/influencer-spend?id= — borra una fila. Solo admin.
export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no autorizado' }, { status: 401 });
  if (!isPanelAdmin(session.panelRole)) return NextResponse.json({ error: 'solo admin' }, { status: 403 });

  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 });
  await db.delete(influencerSpend).where(and(eq(influencerSpend.id, id), eq(influencerSpend.tenantId, session.tenantId)));
  return NextResponse.json({ ok: true });
}

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { opsWallet } from '@/db/schema';
import { isAdmin } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest) {
  if (!(await isAdmin(req))) return NextResponse.json({ error: 'no autorizado' }, { status: 401 });
  let body: { wallet?: number | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }
  let wallet: number | null = null;
  if (body.wallet !== null && body.wallet !== undefined) {
    const n = Number(body.wallet);
    if (!Number.isFinite(n)) return NextResponse.json({ error: 'importe inválido' }, { status: 400 });
    wallet = +n.toFixed(2);
  }
  await db
    .insert(opsWallet)
    .values({ id: 'main', amount: wallet, updatedAt: new Date() })
    .onConflictDoUpdate({ target: opsWallet.id, set: { amount: wallet, updatedAt: new Date() } });
  return NextResponse.json({ ok: true, wallet });
}

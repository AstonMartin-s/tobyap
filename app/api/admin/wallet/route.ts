import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { opsWallet } from '@/db/schema';
import { isAdmin } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';

type WalletExtra = { name: string; amount: number };

export async function PATCH(req: NextRequest) {
  if (!(await isAdmin(req))) return NextResponse.json({ error: 'no autorizado' }, { status: 401 });
  let body: { wallet?: number | null; extras?: Array<{ name?: unknown; amount?: unknown }> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const set: { amount?: number | null; extras?: WalletExtra[]; updatedAt: Date } = { updatedAt: new Date() };

  if ('wallet' in body) {
    let wallet: number | null = null;
    if (body.wallet !== null && body.wallet !== undefined) {
      const n = Number(body.wallet);
      if (!Number.isFinite(n)) return NextResponse.json({ error: 'importe inválido' }, { status: 400 });
      wallet = +n.toFixed(2);
    }
    set.amount = wallet;
  }

  if ('extras' in body) {
    if (!Array.isArray(body.extras)) return NextResponse.json({ error: 'extras inválido' }, { status: 400 });
    const extras: WalletExtra[] = [];
    for (const e of body.extras) {
      const name = String(e?.name ?? '').trim();
      if (!name) continue;
      const n = Number(e?.amount);
      extras.push({ name: name.slice(0, 60), amount: Number.isFinite(n) ? +n.toFixed(2) : 0 });
    }
    set.extras = extras;
  }

  await db
    .insert(opsWallet)
    .values({ id: 'main', amount: set.amount ?? null, extras: set.extras ?? [], updatedAt: new Date() })
    .onConflictDoUpdate({ target: opsWallet.id, set });

  return NextResponse.json({ ok: true });
}

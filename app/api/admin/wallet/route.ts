import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { tenants } from '@/db/schema';
import { isAdmin } from '@/lib/admin-auth';
import { REPORT_EXCLUDE_TENANTS } from '@/lib/reports';

export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest) {
  if (!(await isAdmin(req))) return NextResponse.json({ error: 'no autorizado' }, { status: 401 });
  let body: { slug?: string; wallet?: number | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }
  const slug = body.slug?.trim() ?? '';
  if (!slug || REPORT_EXCLUDE_TENANTS.includes(slug)) {
    return NextResponse.json({ error: 'cliente inválido' }, { status: 400 });
  }
  let wallet: number | null = null;
  if (body.wallet !== null && body.wallet !== undefined) {
    const n = Number(body.wallet);
    if (!Number.isFinite(n)) return NextResponse.json({ error: 'importe inválido' }, { status: 400 });
    wallet = +n.toFixed(2);
  }
  const [row] = await db
    .update(tenants)
    .set({ walletUsd: wallet, updatedAt: new Date() })
    .where(eq(tenants.slug, slug))
    .returning({ slug: tenants.slug });
  if (!row) return NextResponse.json({ error: 'cliente desconocido' }, { status: 404 });
  return NextResponse.json({ ok: true, slug, wallet });
}

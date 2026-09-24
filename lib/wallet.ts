import { eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { ledger, opsWallet, tenants } from '@/db/schema';
import { REPORT_EXCLUDE_TENANTS } from '@/lib/reports';

export type WalletRow = {
  slug: string;
  name: string;
  active: boolean;
  saldo: number;
};

export async function listWalletRows(): Promise<WalletRow[]> {
  const rows = await db
    .select({
      slug: tenants.slug,
      name: tenants.name,
      active: tenants.active,
      saldo: sql<string>`coalesce(sum(coalesce(${ledger.ingreso}, 0) - coalesce(${ledger.gasto}, 0)), 0)`,
    })
    .from(tenants)
    .leftJoin(ledger, eq(ledger.tenantId, tenants.id))
    .where(eq(tenants.role, 'client'))
    .groupBy(tenants.id, tenants.slug, tenants.name, tenants.active);

  return rows
    .filter((r) => !REPORT_EXCLUDE_TENANTS.includes(r.slug))
    .map((r) => ({
      slug: r.slug,
      name: r.name,
      active: r.active !== false,
      saldo: +Number(r.saldo).toFixed(2),
    }))
    .sort((a, b) => b.saldo - a.saldo || a.name.localeCompare(b.name, 'es'));
}

export type WalletExtra = { name: string; amount: number };

export async function getWalletTotal(): Promise<number | null> {
  const [row] = await db.select({ amount: opsWallet.amount }).from(opsWallet).where(eq(opsWallet.id, 'main')).limit(1);
  return row?.amount == null ? null : +Number(row.amount).toFixed(2);
}

export async function getWalletExtras(): Promise<WalletExtra[]> {
  const [row] = await db.select({ extras: opsWallet.extras }).from(opsWallet).where(eq(opsWallet.id, 'main')).limit(1);
  const list = Array.isArray(row?.extras) ? row!.extras : [];
  return list
    .filter((e) => e && typeof e.name === 'string')
    .map((e) => ({ name: String(e.name), amount: +Number(e.amount || 0).toFixed(2) }));
}

import { eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { ledger, tenants } from '@/db/schema';
import { REPORT_EXCLUDE_TENANTS } from '@/lib/reports';

export type WalletRow = {
  slug: string;
  name: string;
  active: boolean;
  saldo: number;
  wallet: number | null;
};

export async function listWalletRows(): Promise<WalletRow[]> {
  const rows = await db
    .select({
      slug: tenants.slug,
      name: tenants.name,
      active: tenants.active,
      wallet: tenants.walletUsd,
      saldo: sql<string>`coalesce(sum(coalesce(${ledger.ingreso}, 0) - coalesce(${ledger.gasto}, 0)), 0)`,
    })
    .from(tenants)
    .leftJoin(ledger, eq(ledger.tenantId, tenants.id))
    .where(eq(tenants.role, 'client'))
    .groupBy(tenants.id, tenants.slug, tenants.name, tenants.active, tenants.walletUsd);

  return rows
    .filter((r) => !REPORT_EXCLUDE_TENANTS.includes(r.slug))
    .map((r) => ({
      slug: r.slug,
      name: r.name,
      active: r.active !== false,
      saldo: +Number(r.saldo).toFixed(2),
      wallet: r.wallet == null ? null : +Number(r.wallet).toFixed(2),
    }))
    .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, 'es'));
}

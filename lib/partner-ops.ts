import { eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { partnerOperations } from '@/db/schema';
import { deposit, withdraw, getBalance, PartnerApiHttpError } from '@/lib/partner-api';
import type { ResolvedTenant } from '@/lib/types';

// ---------------------------------------------------------------------------
// Orquestador de cargas/retiros de saldo real (Partner API) con:
//  - registro previo en `partner_operations` (la fila define la `reference`
//    idempotente ANTES de llamar la API: si algo falla y se reintenta, la misma
//    reference no duplica la carga en la plataforma).
//  - tope máximo por operación (env PARTNER_MAX_OP_ARS, default 50.000).
//  - balance total (cargado/retirado) para el panel.
// El disparo SIEMPRE viene de un operario tocando un botón — nunca automático.
// ---------------------------------------------------------------------------

// Tope por operación (anti-error de tipeo). Prioridad: customField del tenant
// (`max_op_ars`, editable desde el panel admin) → env PARTNER_MAX_OP_ARS → 50.000.
export function maxOpAmount(tenant?: ResolvedTenant): number {
  const cf = Number(tenant?.customFields?.['max_op_ars']);
  if (Number.isFinite(cf) && cf > 0) return cf;
  const v = Number(process.env.PARTNER_MAX_OP_ARS);
  return Number.isFinite(v) && v > 0 ? v : 50_000;
}

export interface OpInput {
  username: string;
  amount: number;
  operator?: string;
  sessionId?: string | null;
  bonusPercent?: number; // solo deposit
}

export interface OpResult {
  ok: boolean;
  type: 'deposit' | 'withdraw';
  amount: number;
  balance?: number;
  duplicate?: boolean;
  reference?: string;
  error?: string;
  code?: string;
}

function validate(amount: number, tenant?: ResolvedTenant): string | null {
  if (!Number.isFinite(amount) || amount <= 0) return 'monto inválido';
  const cap = maxOpAmount(tenant);
  if (amount > cap) return `supera el tope por operación ($${cap.toLocaleString('es-AR')})`;
  return null;
}

async function runOp(
  tenant: ResolvedTenant,
  type: 'deposit' | 'withdraw',
  input: OpInput,
): Promise<OpResult> {
  const bad = validate(input.amount, tenant);
  if (bad) return { ok: false, type, amount: input.amount, error: bad };
  if (tenant.provider !== 'partner_api') return { ok: false, type, amount: input.amount, error: 'cliente sin Partner API' };

  // 1) Registramos la operación PRIMERO — su id genera la reference idempotente.
  const [row] = await db
    .insert(partnerOperations)
    .values({
      tenantId: tenant.id,
      sessionId: input.sessionId ?? null,
      username: input.username,
      type,
      amount: input.amount,
      reference: `pending-${crypto.randomUUID()}`, // temporal, se reemplaza abajo
      bonusPercent: type === 'deposit' ? input.bonusPercent ?? null : null,
      operator: input.operator ?? null,
      status: 'pending',
    })
    .returning();
  const reference = `tob-${type}-${row.id}`;
  await db.update(partnerOperations).set({ reference }).where(eq(partnerOperations.id, row.id));

  // 2) Llamamos la API con esa reference (idempotente).
  try {
    const res = type === 'deposit'
      ? await deposit(tenant, input.username, {
          amount: input.amount,
          reference,
          description: `Carga panel${input.operator ? ' ' + input.operator : ''}`,
          ...(input.bonusPercent ? { bonusPercent: input.bonusPercent, bonusMultiplier: 0 } : {}),
        })
      : await withdraw(tenant, input.username, {
          amount: input.amount,
          reference,
          description: `Retiro panel${input.operator ? ' ' + input.operator : ''}`,
        });

    await db.update(partnerOperations)
      .set({ status: 'done', ledgerId: res.ledgerId, balanceAfter: res.balance, updatedAt: new Date() })
      .where(eq(partnerOperations.id, row.id));

    return { ok: true, type, amount: input.amount, balance: res.balance, duplicate: res.duplicate, reference };
  } catch (e) {
    const code = e instanceof PartnerApiHttpError ? e.code : undefined;
    const msg = e instanceof Error ? e.message : String(e);
    await db.update(partnerOperations)
      .set({ status: 'failed', error: msg.slice(0, 300), updatedAt: new Date() })
      .where(eq(partnerOperations.id, row.id));
    return { ok: false, type, amount: input.amount, error: msg, code };
  }
}

export function depositOp(tenant: ResolvedTenant, input: OpInput): Promise<OpResult> {
  return runOp(tenant, 'deposit', input);
}
export function withdrawOp(tenant: ResolvedTenant, input: OpInput): Promise<OpResult> {
  return runOp(tenant, 'withdraw', input);
}

// Saldo en vivo (solo lectura).
export async function consultBalance(tenant: ResolvedTenant, username: string): Promise<{ ok: boolean; balance?: number; error?: string }> {
  if (tenant.provider !== 'partner_api') return { ok: false, error: 'cliente sin Partner API' };
  try {
    const balance = await getBalance(tenant, username);
    return { ok: true, balance };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// Balance total del jugador según NUESTRAS operaciones (cargado / retirado / neto).
export async function operationsSummary(tenant: ResolvedTenant, username: string): Promise<{ cargado: number; retirado: number; balance: number }> {
  const [r] = (await db.execute(sql`
    SELECT
      coalesce(sum(amount) filter (where type = 'deposit'  and status = 'done'), 0)::float AS cargado,
      coalesce(sum(amount) filter (where type = 'withdraw' and status = 'done'), 0)::float AS retirado
    FROM partner_operations
    WHERE tenant_id = ${tenant.id} AND username = ${username}
  `)) as unknown as Array<{ cargado: number; retirado: number }>;
  const cargado = Number(r?.cargado ?? 0);
  const retirado = Number(r?.retirado ?? 0);
  return { cargado, retirado, balance: cargado - retirado };
}

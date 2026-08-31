import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { partnerOperations } from '@/db/schema';
import { getUser, depositWithdraw, KingApiError } from '@/lib/king-api';
import type { ResolvedTenant } from '@/lib/types';

// ---------------------------------------------------------------------------
// Orquestador de cargas/retiros para King (greenbet/dat4win).
// Mismo patrón que partner-ops.ts: registra en partner_operations ANTES de
// llamar la API. La API de King NO tiene campo de referencia idempotente,
// así que la protección es a nivel nuestro (la fila marca status='done').
// ---------------------------------------------------------------------------

// Tope por operación (anti-error de tipeo). Prioridad: customField del tenant
// (`max_op_ars`, editable desde el panel admin) → env KING_MAX_OP_ARS → 50.000.
export function maxOpAmount(tenant?: ResolvedTenant): number {
  const cf = Number(tenant?.customFields?.['max_op_ars']);
  if (Number.isFinite(cf) && cf > 0) return cf;
  const v = Number(process.env.KING_MAX_OP_ARS);
  return Number.isFinite(v) && v > 0 ? v : 50_000;
}

export interface KingOpInput {
  username: string;
  amount: number;
  operator?: string;
  sessionId?: string | null;
  bonusPercent?: number;
}

export interface KingOpResult {
  ok: boolean;
  type: 'deposit' | 'withdraw';
  amount: number;
  balance?: number;
  error?: string;
  reference?: string;
}

function validate(amount: number, tenant?: ResolvedTenant): string | null {
  if (!Number.isFinite(amount) || amount <= 0) return 'monto inválido';
  const cap = maxOpAmount(tenant);
  if (amount > cap) return `supera el tope por operación ($${cap.toLocaleString('es-AR')})`;
  return null;
}

async function resolvePlayerId(tenant: ResolvedTenant, username: string): Promise<number> {
  const user = await getUser(tenant, username);
  return user.id;
}

async function runOp(
  tenant: ResolvedTenant,
  type: 'deposit' | 'withdraw',
  input: KingOpInput,
): Promise<KingOpResult> {
  const bad = validate(input.amount, tenant);
  if (bad) return { ok: false, type, amount: input.amount, error: bad };

  const playerId = await resolvePlayerId(tenant, input.username);

  const [row] = await db
    .insert(partnerOperations)
    .values({
      tenantId: tenant.id,
      sessionId: input.sessionId ?? null,
      username: input.username,
      type,
      amount: input.amount,
      reference: `king-${type}-${crypto.randomUUID()}`,
      bonusPercent: type === 'deposit' ? input.bonusPercent ?? null : null,
      operator: input.operator ?? null,
      status: 'pending',
    })
    .returning();

  try {
    const res = await depositWithdraw(tenant, {
      destinationId: playerId,
      action: type === 'deposit' ? 'add' : 'out',
      amount: input.amount,
      bonus: type === 'deposit' ? input.bonusPercent : undefined,
    });

    await db.update(partnerOperations)
      .set({ status: 'done', balanceAfter: res.balance, updatedAt: new Date() })
      .where(eq(partnerOperations.id, row.id));

    return { ok: true, type, amount: input.amount, balance: res.balance ?? undefined, reference: row.id };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db.update(partnerOperations)
      .set({ status: 'failed', error: msg.slice(0, 300), updatedAt: new Date() })
      .where(eq(partnerOperations.id, row.id));
    return { ok: false, type, amount: input.amount, error: msg };
  }
}

export function kingDepositOp(tenant: ResolvedTenant, input: KingOpInput): Promise<KingOpResult> {
  return runOp(tenant, 'deposit', input);
}

export function kingWithdrawOp(tenant: ResolvedTenant, input: KingOpInput): Promise<KingOpResult> {
  return runOp(tenant, 'withdraw', input);
}

export async function kingConsultBalance(tenant: ResolvedTenant, username: string): Promise<{ ok: boolean; balance?: number; bonus?: number; error?: string }> {
  try {
    const user = await getUser(tenant, username);
    // King separa saldo real (`balance`) de la billetera de bono (`bonus`). El bono
    // de la promo se acredita en `bonus`, por eso hay que exponerlo aparte o el
    // operario cree que "no se acreditó" al mirar solo el saldo.
    return { ok: true, balance: user.balance, bonus: user.bonus };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

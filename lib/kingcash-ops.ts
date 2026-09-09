import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { partnerOperations } from '@/db/schema';
import { deposit, withdraw, getPlayerOrThrow, KingcashApiError } from '@/lib/kingcash-api';
import type { ResolvedTenant } from '@/lib/types';

// ---------------------------------------------------------------------------
// Orquestador de cargas/retiros para Kingcash7 (panel de agente).
// Mismo patrón que partner-ops.ts / king-ops.ts: registra en `partner_operations`
// ANTES de llamar la API (la fila define la idempotencia a nivel nuestro: la
// plataforma NO tiene referencia idempotente, así que evitamos duplicar con el
// estado de la fila + el disparo manual del operario).
// El bono lo aplica el agente automáticamente (config de su lado) — acá NO
// mandamos bonusPercent (el form de balance no lo acepta).
// ---------------------------------------------------------------------------

export function maxOpAmount(tenant?: ResolvedTenant): number {
  const cf = Number(tenant?.customFields?.['max_op_ars']);
  if (Number.isFinite(cf) && cf > 0) return cf;
  const v = Number(process.env.KINGCASH_MAX_OP_ARS);
  return Number.isFinite(v) && v > 0 ? v : 50_000;
}

export interface KingcashOpInput {
  username: string;
  amount: number;
  operator?: string;
  sessionId?: string | null;
  bonusPercent?: number; // ignorado (bono automático del agente); se acepta por compat de firma
}

export interface KingcashOpResult {
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

async function runOp(
  tenant: ResolvedTenant,
  type: 'deposit' | 'withdraw',
  input: KingcashOpInput,
): Promise<KingcashOpResult> {
  const bad = validate(input.amount, tenant);
  if (bad) return { ok: false, type, amount: input.amount, error: bad };
  if (tenant.provider !== 'kingcash') return { ok: false, type, amount: input.amount, error: 'cliente sin API Kingcash' };

  // Resolvemos el id del jugador (por login) ANTES de registrar, para fallar
  // temprano si el usuario no existe.
  let playerId: number;
  try {
    const player = await getPlayerOrThrow(tenant, input.username);
    playerId = player.id;
  } catch (e) {
    return { ok: false, type, amount: input.amount, error: e instanceof Error ? e.message : String(e) };
  }

  const [row] = await db
    .insert(partnerOperations)
    .values({
      tenantId: tenant.id,
      sessionId: input.sessionId ?? null,
      username: input.username,
      type,
      amount: input.amount,
      reference: `kingcash-${type}-${crypto.randomUUID()}`,
      bonusPercent: null,
      operator: input.operator ?? null,
      status: 'pending',
    })
    .returning();

  try {
    const res = type === 'deposit'
      ? await deposit(tenant, playerId, input.amount)
      : await withdraw(tenant, playerId, input.amount);

    await db.update(partnerOperations)
      .set({ status: 'done', balanceAfter: res.balance, updatedAt: new Date() })
      .where(eq(partnerOperations.id, row.id));

    return { ok: true, type, amount: input.amount, balance: res.balance, reference: row.id };
  } catch (e) {
    const msg = e instanceof KingcashApiError ? e.message : (e instanceof Error ? e.message : String(e));
    await db.update(partnerOperations)
      .set({ status: 'failed', error: msg.slice(0, 300), updatedAt: new Date() })
      .where(eq(partnerOperations.id, row.id));
    return { ok: false, type, amount: input.amount, error: msg };
  }
}

export function kingcashDepositOp(tenant: ResolvedTenant, input: KingcashOpInput): Promise<KingcashOpResult> {
  return runOp(tenant, 'deposit', input);
}

export function kingcashWithdrawOp(tenant: ResolvedTenant, input: KingcashOpInput): Promise<KingcashOpResult> {
  return runOp(tenant, 'withdraw', input);
}

// Saldo en vivo (solo lectura). `bonus` expone el wager (rollover) pendiente.
export async function kingcashConsultBalance(
  tenant: ResolvedTenant,
  username: string,
): Promise<{ ok: boolean; balance?: number; bonus?: number; error?: string }> {
  try {
    const p = await getPlayerOrThrow(tenant, username);
    return { ok: true, balance: p.balance, bonus: p.wager };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

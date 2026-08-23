import type { ResolvedTenant } from '@/lib/types';

// ---------------------------------------------------------------------------
// King API (greenbet / dat4win) — carga, retiro, búsqueda de jugadores y
// reset de contraseña. Autenticación: token en el body (deposit-withdraw,
// reset-password) o en query string (get-user). El source_id del agente se
// guarda en customFields.king_source_id.
// ---------------------------------------------------------------------------

export class KingApiError extends Error {
  status?: string;
  constructor(message: string, status?: string) {
    super(message);
    this.status = status;
  }
}

function baseUrl(tenant: ResolvedTenant): string {
  if (!tenant.partnerApiUrl) throw new Error(`tenant ${tenant.slug} sin partnerApiUrl (King API base URL)`);
  return tenant.partnerApiUrl.replace(/\/$/, '');
}

function token(tenant: ResolvedTenant): string {
  if (!tenant.partnerApiKey) throw new Error(`tenant ${tenant.slug} sin partnerApiKey (King API token)`);
  return tenant.partnerApiKey;
}

function sourceId(tenant: ResolvedTenant): number {
  const sid = tenant.customFields.king_source_id;
  if (!sid) throw new Error(`tenant ${tenant.slug} sin customFields.king_source_id`);
  return sid;
}

// ── Buscar jugador por username → id numérico ─────────────────────────────
export interface KingUser {
  id: number;
  username: string;
  balance: number;
  bonus: number;
  roleId: number;
  parentId: number;
}

export async function getUser(tenant: ResolvedTenant, username: string): Promise<KingUser> {
  const url = `${baseUrl(tenant)}/api/get-user?token=${encodeURIComponent(token(tenant))}&username=${encodeURIComponent(username)}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;

  if (j.success === false) {
    throw new KingApiError(String(j.message ?? 'User not found'));
  }

  const d = (j.data ?? {}) as Record<string, unknown>;
  return {
    id: Number(d.id),
    username: String(d.username ?? username),
    balance: Number(d.balance ?? 0),
    bonus: Number(d.bonus ?? 0),
    roleId: Number(d.role_id ?? 0),
    parentId: Number(d.parent_id ?? 0),
  };
}

// ── Carga / Retiro ────────────────────────────────────────────────────────
export interface KingMoneyResult {
  success: boolean;
  message: string;
  balance: number | null;
  warning: string | null;
  status?: string;
  disponible?: string;
}

export async function depositWithdraw(
  tenant: ResolvedTenant,
  input: {
    destinationId: number;
    action: 'add' | 'out';
    amount: number;
    bonus?: number;
    wager?: number;
    bonusMult?: number;
    forceWithdraw?: boolean;
    forceBonoConflict?: boolean;
  },
): Promise<KingMoneyResult> {
  const body: Record<string, unknown> = {
    token: token(tenant),
    source_id: sourceId(tenant),
    destination_id: input.destinationId,
    action: input.action,
    amount: input.amount,
  };
  if (input.bonus != null && input.bonus > 0) body.bonus = input.bonus;
  if (input.wager != null) body.wager = input.wager;
  if (input.bonusMult != null) body.bonus_mult = input.bonusMult;
  if (input.forceWithdraw) body.force_withdraw = true;
  if (input.forceBonoConflict) body.force_bono_conflict = true;

  const res = await fetch(`${baseUrl(tenant)}/api/deposit-withdraw`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;

  const result: KingMoneyResult = {
    success: j.success === true,
    message: String(j.message ?? ''),
    balance: j.balance != null ? parseFloat(String(j.balance).replace(/\./g, '').replace(',', '.')) : null,
    warning: j.warning != null ? String(j.warning) : null,
    status: j.status as string | undefined,
    disponible: j.disponible as string | undefined,
  };

  if (!result.success) {
    throw new KingApiError(result.message, result.status);
  }
  return result;
}

// ── Reset de contraseña ───────────────────────────────────────────────────
export async function resetPassword(
  tenant: ResolvedTenant,
  destinationId: number,
  newPassword: string,
): Promise<{ success: boolean; message: string }> {
  const res = await fetch(`${baseUrl(tenant)}/api/reset-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      token: token(tenant),
      destination_id: destinationId,
      new_password: newPassword,
    }),
  });
  const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { success: j.success === true, message: String(j.message ?? '') };
}

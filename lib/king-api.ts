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

// ── Alta de jugador (creación de cuenta directa por Green API) ─────────────
// Para clientes greenbet SIN Pagoda: la cuenta se crea acá, no por dat4win.
// ⚠️ PENDIENTE DE VERIFICAR CONTRA LA DOC DE GREEN (`Nuevas-funciones-API green`
//    / `API-Integracion-CRM Green`): endpoint exacto, nombres de campos y forma
//    de la respuesta. Dejo la estructura alineada al resto de king-api (token +
//    source_id en el body). Ajustar `CREATE_USER_PATH` y el mapeo cuando llegue.
export const CREATE_USER_PATH = '/api/create-user';

export interface KingCreateUserInput {
  username: string;
  password: string;
  phone?: string;
  name?: string;
}
export interface KingCreatedUser {
  id: number | null;
  username: string;
  password: string;
  existing: boolean;
}

export async function createUser(
  tenant: ResolvedTenant,
  input: KingCreateUserInput,
): Promise<KingCreatedUser> {
  const body: Record<string, unknown> = {
    token: token(tenant),
    source_id: sourceId(tenant),
    username: input.username,
    password: input.password,
  };
  if (input.phone) body.phone = input.phone;
  if (input.name) body.name = input.name;

  const res = await fetch(`${baseUrl(tenant)}${CREATE_USER_PATH}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;

  if (j.success === false) {
    throw new KingApiError(String(j.message ?? 'No se pudo crear la cuenta'), j.status as string | undefined);
  }
  const d = (j.data ?? j) as Record<string, unknown>;
  return {
    id: d.id != null ? Number(d.id) : null,
    username: String(d.username ?? input.username),
    password: String(d.password ?? input.password),
    existing: j.existing === true || j.status === 'exists',
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

// ── Bono independiente (add-bonus) ─────────────────────────────────────────
// Otorga un bono de saldo real SIN carga de fichas asociada (promo manual).
// `bonus` es un MONTO directo (no %). `mult` = rollover del bono (default 2).
export async function addBonus(
  tenant: ResolvedTenant,
  input: { destinationId: number; bonus: number; mult?: number; forceBonoConflict?: boolean },
): Promise<{ success: boolean; message: string; status?: string }> {
  const body: Record<string, unknown> = {
    token: token(tenant),
    source_id: sourceId(tenant),
    destination_id: input.destinationId,
    action: 'add',
    bonus: input.bonus,
  };
  if (input.mult != null) body.mult = input.mult;
  if (input.forceBonoConflict) body.force_bono_conflict = true;

  const res = await fetch(`${baseUrl(tenant)}/api/add-bonus`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const result = {
    success: j.success === true,
    message: String(j.message ?? ''),
    status: j.status as string | undefined,
  };
  if (!result.success) throw new KingApiError(result.message, result.status);
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

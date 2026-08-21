import type { ResolvedTenant } from '@/lib/types';

// ---------------------------------------------------------------------------
// Partner API (KingPlay / bblack) — alta de jugador server-to-server.
// Docs: PARTNER-APIv.1.11.pdf. Límite: 60 req/min por key (throttle propio abajo).
// A diferencia de Pagoda, ACÁ nosotros generamos username/password — la
// plataforma no los inventa. Carga de fichas: MANUAL por ahora (igual a King),
// deposit/withdraw quedan firmados sin usar para la fase automática futura.
// ---------------------------------------------------------------------------

const MIN_INTERVAL_MS = 1100; // ~54 req/min — headroom bajo el límite de 60/min
let lastAt = 0;
let chain: Promise<unknown> = Promise.resolve();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function paced<T>(fn: () => Promise<T>): Promise<T> {
  const run = async (): Promise<T> => {
    const wait = Math.max(0, MIN_INTERVAL_MS - (Date.now() - lastAt));
    if (wait) await sleep(wait);
    lastAt = Date.now();
    return fn();
  };
  const p = chain.then(run, run);
  chain = p.then(() => undefined, () => undefined);
  return p;
}

function pfetch(url: string, init?: RequestInit, tries = 3): Promise<Response> {
  return paced(async () => {
    let res: Response | undefined;
    for (let i = 0; i < tries; i++) {
      res = await fetch(url, init);
      if (res.status !== 429) return res;
      await sleep(1500 * (i + 1));
    }
    return res as Response;
  });
}

interface PartnerApiError {
  error?: { code?: string; message?: string };
}

export class PartnerApiHttpError extends Error {
  status: number;
  code?: string;
  constructor(status: number, code: string | undefined, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function call(
  tenant: ResolvedTenant,
  path: string,
  init: { method: 'GET' | 'POST' | 'PUT'; body?: unknown },
): Promise<unknown> {
  if (!tenant.partnerApiUrl || !tenant.partnerApiKey) {
    throw new Error(`tenant ${tenant.slug} sin partnerApiUrl / partnerApiKey`);
  }
  const url = `${tenant.partnerApiUrl.replace(/\/$/, '')}${path}`;
  const res = await pfetch(url, {
    method: init.method,
    headers: {
      'X-Api-Key': tenant.partnerApiKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const j = (await res.json().catch(() => ({}))) as Record<string, unknown> & PartnerApiError;
  if (!res.ok) {
    throw new PartnerApiHttpError(res.status, j.error?.code, j.error?.message ?? `partner-api ${res.status}`);
  }
  return j;
}

// ── Alta de jugador ─────────────────────────────────────────────────────────
export interface CreatePlayerInput {
  username: string;
  password: string;
  phone?: string;
  email?: string;
  agentId?: number;
}
export interface PlayerAccount {
  username: string;
  email: string | null;
  active: boolean;
  balance: number;
  createdAt: string | null;
}

export async function createPlayer(tenant: ResolvedTenant, input: CreatePlayerInput): Promise<PlayerAccount> {
  const j = (await call(tenant, '/players', {
    method: 'POST',
    body: {
      username: input.username,
      password: input.password,
      ...(input.phone ? { phone: input.phone } : {}),
      ...(input.email ? { email: input.email } : {}),
      ...(input.agentId ? { agent_id: input.agentId } : {}),
    },
  })) as { player?: Record<string, unknown> };
  const p = j.player ?? {};
  return {
    username: String(p.username ?? input.username),
    email: (p.email as string) ?? null,
    active: p.active !== false,
    balance: Number(p.balance ?? 0),
    createdAt: (p.created_at as string) ?? null,
  };
}

// 3-18 chars [a-zA-Z0-9_]. Generamos desde el nombre + reintentamos con sufijo
// numérico si el manual dice que el username ya existe (validation error 422).
export function buildPlayerUsername(name?: string | null, phone?: string, attempt = 0): string {
  const clean = (name ?? '').normalize('NFD').replace(/[^a-zA-Z0-9]/g, '');
  let base = clean.slice(0, 10);
  if (base.length < 3) {
    const digits = (phone ?? '').replace(/\D/g, '').slice(-6);
    base = ('user' + digits).slice(0, 10);
  }
  const suffix = attempt > 0 ? String(attempt) : String(Math.floor(Math.random() * 900) + 100);
  return `${base}${suffix}`.slice(0, 18);
}

// Contraseña SIMPLE y fácil de tipear: sílabas pronunciables (consonante+vocal,
// todo en minúscula, sin caracteres ambiguos) + 3 dígitos. Ej: "mekabu482".
// Cumple el mínimo de 6 chars de la plataforma y es mucho más fácil que una
// contraseña con mayúsculas/símbolos.
export function randomPlayerPassword(): string {
  const cons = 'bcdfgjkmnprstv'; // sin l/q/x/z/h/w (ambiguas o raras al dictar)
  const vow = 'aeiou';
  const pick = (s: string) => s[Math.floor(Math.random() * s.length)];
  let word = '';
  for (let i = 0; i < 3; i++) word += pick(cons) + pick(vow); // 3 sílabas = 6 letras
  const digits = String(Math.floor(100 + Math.random() * 900)); // 3 dígitos
  return word + digits; // 9 chars, todo minúscula, pronunciable
}

// Crea el jugador reintentando con otro username si el elegido ya existe.
export async function createPlayerWithRetry(
  tenant: ResolvedTenant,
  opts: { name?: string | null; phone: string; maxAttempts?: number },
): Promise<{ account: PlayerAccount; username: string; password: string }> {
  const password = randomPlayerPassword();
  const maxAttempts = opts.maxAttempts ?? 4;
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const username = buildPlayerUsername(opts.name, opts.phone, attempt);
    try {
      const account = await createPlayer(tenant, { username, password, phone: opts.phone });
      return { account, username, password };
    } catch (e) {
      lastErr = e;
      // Solo reintentamos si es un 422 de validación (probable username tomado).
      if (!(e instanceof PartnerApiHttpError) || e.status !== 422) throw e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('createPlayerWithRetry: sin cupo de reintentos');
}

// ── Login único (SSO) ───────────────────────────────────────────────────────
export async function playerSession(tenant: ResolvedTenant, username: string): Promise<{ redirectUrl: string | null; token: string | null }> {
  const j = (await call(tenant, `/players/${encodeURIComponent(username)}/session`, { method: 'POST', body: {} })) as {
    redirect_url?: string;
    token?: string;
  };
  return { redirectUrl: j.redirect_url ?? null, token: j.token ?? null };
}

// ── Solo lectura: saldo + config (no se usan hoy en el flujo, listas para la fase de saldo en vivo) ──
export async function getPlayer(tenant: ResolvedTenant, username: string): Promise<Record<string, unknown>> {
  const j = (await call(tenant, `/players/${encodeURIComponent(username)}`, { method: 'GET' })) as { player?: Record<string, unknown> };
  return j.player ?? {};
}

export async function getConfig(tenant: ResolvedTenant): Promise<Record<string, unknown>> {
  return (await call(tenant, '/config', { method: 'GET' })) as Record<string, unknown>;
}

// ── Carga / retiro de fichas (movimiento de saldo real) ─────────────────────
// La reference es idempotente: mismo valor = misma operación (no duplica). El
// caller (lib/partner-ops) la deriva del id de la fila registrada. Devuelve el
// body de la API (incluye `balance` resultante y `duplicate`).
export interface MoneyOpResult {
  duplicate: boolean;
  balance: number;
  ledgerId: number | null;
  raw: Record<string, unknown>;
}

function parseMoneyResult(j: Record<string, unknown>): MoneyOpResult {
  const op = (j.operation ?? {}) as Record<string, unknown>;
  return {
    duplicate: j.duplicate === true,
    balance: Number(j.balance ?? 0),
    ledgerId: op.ledger_id != null ? Number(op.ledger_id) : null,
    raw: j,
  };
}

export async function deposit(
  tenant: ResolvedTenant,
  username: string,
  input: { amount: number; reference: string; description?: string; multiplier?: number; bonusPercent?: number; bonusMultiplier?: number },
): Promise<MoneyOpResult> {
  const j = (await call(tenant, `/players/${encodeURIComponent(username)}/deposit`, {
    method: 'POST',
    body: {
      amount: input.amount,
      reference: input.reference,
      ...(input.description ? { description: input.description } : {}),
      ...(input.multiplier !== undefined ? { multiplier: input.multiplier } : {}),
      ...(input.bonusPercent !== undefined ? { bonus_percent: input.bonusPercent } : {}),
      ...(input.bonusMultiplier !== undefined ? { bonus_multiplier: input.bonusMultiplier } : {}),
    },
  })) as Record<string, unknown>;
  return parseMoneyResult(j);
}

export async function withdraw(
  tenant: ResolvedTenant,
  username: string,
  input: { amount: number; reference: string; description?: string },
): Promise<MoneyOpResult> {
  const j = (await call(tenant, `/players/${encodeURIComponent(username)}/withdraw`, {
    method: 'POST',
    body: {
      amount: input.amount,
      reference: input.reference,
      ...(input.description ? { description: input.description } : {}),
    },
  })) as Record<string, unknown>;
  return parseMoneyResult(j);
}

// Saldo simple (número) — atajo sobre getPlayer para el botón "Consultar saldo".
export async function getBalance(tenant: ResolvedTenant, username: string): Promise<number> {
  const p = await getPlayer(tenant, username);
  return Number((p as Record<string, unknown>).balance ?? 0);
}

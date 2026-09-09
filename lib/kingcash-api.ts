import type { ResolvedTenant } from '@/lib/types';

// ---------------------------------------------------------------------------
// Kingcash7 (panel de agente "baso-x/oskar") — alta de jugador + carga/retiro.
// Plataforma DISTINTA de King/Green (lib/king-api) y de la Partner API kplay
// (lib/partner-api). Contrato deducido y verificado en vivo (2026-09-09) contra
// `https://ag.kingcash7.net`:
//
//   Base:   {domain}/index.php?act=admin&area={area}&response=js
//   Auth:   POST login+password a area=login  → cookie PHPSESSID (sesión).
//           (Existe api_token, pero por defecto NO tiene permisos de escritura
//            hasta editarlos en el panel — por eso usamos login/clave.)
//   Alta:   POST area=createuser&type=frame  { group=5, sended=true, name,
//           login, password, balance? }.  Disparador clave: `sended=true`
//           (sin él sólo re-dibuja el form). group 5 = jugador ("Terminal").
//   Buscar: GET  area=users&response=js&search={login}&limit=..  → users[]
//           { id, login, balances{ARS}, wager{ARS} }.
//   Saldo:  GET  area=balance&id={id}&type=frame  (ARMA la operación) y luego
//           POST area=balance&id={id}&response=js { operation:in|out, send=true,
//           amount, balance_currency=ARS, printing=false }.
//           ⚠️ El GET del frame es OBLIGATORIO antes del POST: sin él la carga
//              es un no-op silencioso.
//
// Moneda: ARS. El agente puede tener un BONO AUTOMÁTICO configurado de su lado
// (ej. +200%): un depósito de X deja X real + bono, con `wager` (rollover) por
// el bono. No lo controlamos desde acá (no hay parámetro de bono en el form).
// El retiro sólo libera lo NO sujeto a wager (la plataforma bloquea el resto).
// ---------------------------------------------------------------------------

export class KingcashApiError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

// Credenciales del panel: guardadas cifradas en tenant.partnerApiKey como JSON
// {"login","password"}. Aceptamos también el formato corto "login:password".
interface KingcashCreds {
  login: string;
  password: string;
}

function parseCreds(tenant: ResolvedTenant): KingcashCreds {
  const raw = tenant.partnerApiKey;
  if (!raw) throw new KingcashApiError(`tenant ${tenant.slug} sin credenciales kingcash (partnerApiKey)`);
  const trimmed = raw.trim();
  if (trimmed.startsWith('{')) {
    const j = JSON.parse(trimmed) as { login?: string; password?: string };
    if (!j.login || !j.password) throw new KingcashApiError(`tenant ${tenant.slug}: credenciales kingcash incompletas`);
    return { login: j.login, password: j.password };
  }
  const idx = trimmed.indexOf(':');
  if (idx <= 0) throw new KingcashApiError(`tenant ${tenant.slug}: credenciales kingcash inválidas (esperado JSON o login:password)`);
  return { login: trimmed.slice(0, idx), password: trimmed.slice(idx + 1) };
}

function baseUrl(tenant: ResolvedTenant): string {
  if (!tenant.partnerApiUrl) throw new KingcashApiError(`tenant ${tenant.slug} sin partnerApiUrl (dominio kingcash)`);
  // Aceptamos que venga con o sin /index.php: normalizamos al origin.
  return tenant.partnerApiUrl.replace(/\/index\.php.*$/i, '').replace(/\/$/, '');
}

function urlFor(tenant: ResolvedTenant, area: string, extra?: Record<string, string>): string {
  const q = new URLSearchParams({ act: 'admin', area, response: 'js', ...(extra ?? {}) });
  return `${baseUrl(tenant)}/index.php?${q.toString()}`;
}

// ── Sesión (cookie PHPSESSID) con cache por tenant ──────────────────────────
const SESSION_TTL_MS = 20 * 60_000; // 20 min; re-login si expira o da "No access"
const sessions = new Map<string, { cookie: string; exp: number }>();

async function login(tenant: ResolvedTenant): Promise<string> {
  const { login: user, password } = parseCreds(tenant);
  const res = await fetch(urlFor(tenant, 'login'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ login: user, password }).toString(),
  });
  const setCookies = res.headers.getSetCookie?.() ?? [];
  const php = setCookies.map((c) => c.split(';')[0]).find((c) => c.startsWith('PHPSESSID='));
  const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!php || j.status !== 'success') {
    throw new KingcashApiError(`login kingcash falló (${tenant.slug}): ${String(j.error ?? j.status ?? res.status)}`, res.status);
  }
  sessions.set(tenant.id, { cookie: php, exp: Date.now() + SESSION_TTL_MS });
  return php;
}

async function cookie(tenant: ResolvedTenant): Promise<string> {
  const hit = sessions.get(tenant.id);
  if (hit && hit.exp > Date.now()) return hit.cookie;
  return login(tenant);
}

// Llamada autenticada. Reintenta una vez re-logueando si detecta "No access".
async function call(
  tenant: ResolvedTenant,
  area: string,
  opts: { extra?: Record<string, string>; method?: 'GET' | 'POST'; form?: Record<string, string>; json?: boolean } = {},
  _retry = false,
): Promise<{ status: number; text: string; json: Record<string, unknown> | null }> {
  const ck = await cookie(tenant);
  const method = opts.method ?? (opts.form ? 'POST' : 'GET');
  const res = await fetch(urlFor(tenant, area, opts.extra), {
    method,
    headers: {
      Cookie: ck,
      Accept: 'application/json',
      ...(opts.form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    body: opts.form ? new URLSearchParams(opts.form).toString() : undefined,
  });
  const text = await res.text();
  let json: Record<string, unknown> | null = null;
  try { json = JSON.parse(text) as Record<string, unknown>; } catch { /* HTML frame */ }

  // Sesión caída → re-login una vez.
  if (!_retry && json && json.error === 'No access') {
    sessions.delete(tenant.id);
    return call(tenant, area, opts, true);
  }
  return { status: res.status, text, json };
}

// ── Buscar jugador por login → id + saldo ───────────────────────────────────
export interface KingcashPlayer {
  id: number;
  login: string;
  balance: number; // ARS
  wager: number; // rollover pendiente (bono no liberado)
}

function parseArs(v: unknown): number {
  if (v == null) return 0;
  // La API devuelve strings tipo "1,234.56" (coma miles, punto decimal).
  return Number(String(v).replace(/,/g, '')) || 0;
}

export async function findPlayer(tenant: ResolvedTenant, login: string): Promise<KingcashPlayer | null> {
  const { json } = await call(tenant, 'users', { extra: { search: login, limit: '50' } });
  const rows = (json?.users as Array<Record<string, unknown>> | undefined) ?? [];
  const row = rows.find((r) => String(r.login ?? '') === login);
  if (!row) return null;
  const balances = (row.balances as Record<string, unknown> | undefined) ?? {};
  const wager = (row.wager as Record<string, unknown> | undefined) ?? {};
  return {
    id: Number(row.id),
    login,
    balance: parseArs(balances.ARS),
    wager: parseArs(wager.ARS),
  };
}

// ── Alta de jugador ─────────────────────────────────────────────────────────
export interface KingcashCreateInput {
  login: string;
  password: string;
  name?: string;
  balance?: number; // carga inicial opcional (default 0)
}

// Crea el jugador (group 5) y confirma leyéndolo. La API re-dibuja el form tanto
// en éxito como en colisión de login, así que la confirmación es por lectura.
export async function createPlayer(tenant: ResolvedTenant, input: KingcashCreateInput): Promise<KingcashPlayer> {
  // Si ya existe un login idéntico, NO lo pisamos (sería cuenta ajena).
  const pre = await findPlayer(tenant, input.login);
  if (pre) throw new KingcashApiError('Username already exists', 409);

  await call(tenant, 'createuser', {
    extra: { type: 'frame' },
    form: {
      group: '5',
      sended: 'true',
      name: input.name ?? input.login,
      login: input.login,
      password: input.password,
      balance: String(input.balance ?? 0),
    },
  });

  const created = await findPlayer(tenant, input.login);
  if (!created) throw new KingcashApiError('no se pudo confirmar el alta del jugador');
  return created;
}

// ── Carga / retiro de fichas ────────────────────────────────────────────────
export interface KingcashMoneyResult {
  balance: number; // ARS resultante
  wager: number;
  raw: Record<string, unknown>;
}

async function money(
  tenant: ResolvedTenant,
  playerId: number,
  operation: 'in' | 'out',
  amount: number,
): Promise<KingcashMoneyResult> {
  // 1) GET del frame: ARMA la operación (obligatorio, si no el POST es no-op).
  await call(tenant, 'balance', { extra: { id: String(playerId), type: 'frame' }, method: 'GET' });
  // 2) POST del movimiento.
  const { json } = await call(tenant, 'balance', {
    extra: { id: String(playerId) },
    form: {
      operation,
      send: 'true',
      amount: String(amount),
      balance_currency: 'ARS',
      printing: 'false',
    },
  });
  const ok = json && (json.successMessage != null);
  if (!ok) {
    const msg = String((json && (json.error ?? json.errorMessage)) ?? 'la operación no se aplicó (posible wager/rollover pendiente)');
    throw new KingcashApiError(msg);
  }
  const currencies = (json!.currencies as Record<string, unknown> | undefined) ?? {};
  return { balance: parseArs(currencies.ARS), wager: parseArs(json!.wager), raw: json! };
}

// Devuelve el jugador (para resolver id) y el saldo. Reutilizado por ops.
export async function getPlayerOrThrow(tenant: ResolvedTenant, login: string): Promise<KingcashPlayer> {
  const p = await findPlayer(tenant, login);
  if (!p) throw new KingcashApiError(`jugador ${login} no encontrado`);
  return p;
}

export async function deposit(tenant: ResolvedTenant, playerId: number, amount: number): Promise<KingcashMoneyResult> {
  return money(tenant, playerId, 'in', amount);
}

export async function withdraw(tenant: ResolvedTenant, playerId: number, amount: number): Promise<KingcashMoneyResult> {
  return money(tenant, playerId, 'out', amount);
}

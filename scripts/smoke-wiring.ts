// Smoke de CABLEADO (Fase 1 + Fase 2). Lógica pura: NO toca la DB ni prod ni Meta.
// Verifica las piezas deterministas que introdujo el hardening:
//   - event_id de Cargo (idempotencia por lead / sesión)
//   - token HMAC del comprobante (firmar/verificar/expiración/legacy)
//   - rate limit in-memory (soft 429 + kill switch)
// Correr: npm run smoke:wiring

// Env de prueba ANTES de importar los módulos que la leen en runtime.
process.env.FILE_SIGNING_SECRET = 'smoke-secret-abc';
process.env.FILE_TOKEN_TTL_SEC = '3600';
process.env.FILE_LEGACY_DAYS = '14';

import { cargoEventId } from '@/lib/cargo/emit';
import { signFilePath, verifyFileToken, withinLegacyWindow } from '@/lib/chat/fileToken';
import { rateLimit } from '@/lib/rateLimit';
import { parseChatConfig, DEFAULT_HEADER } from '@/lib/chat/brand';

let failed = 0;
function check(name: string, cond: boolean) {
  console.log(`${cond ? 'OK  ' : 'FAIL'} · ${name}`);
  if (!cond) failed++;
}

// --- 1) event_id de Cargo: 1 sola atribución por lead ----------------------
check('cargo event_id usa kommoLeadId', cargoEventId({ kommoLeadId: 123 }) === 'cargo-123');
check('cargo event_id cae a sessionKey', cargoEventId({ sessionKey: 'abc' }) === 'cargo-session-abc');
check('cargo event_id prefiere lead sobre sesión', cargoEventId({ kommoLeadId: 9, sessionKey: 'x' }) === 'cargo-9');
check('cargo event_id vacío sin ids', cargoEventId({}) === '');

// --- 2) token HMAC del comprobante -----------------------------------------
const url = signFilePath('king', 'sess-1');
const q = new URL(`https://x${url}`);
const e = q.searchParams.get('e');
const t = q.searchParams.get('t');
check('signFilePath agrega e y t', !!e && !!t);
check('verifyFileToken acepta token válido', verifyFileToken('king', 'sess-1', null, e, t));
check('verifyFileToken rechaza token adulterado', !verifyFileToken('king', 'sess-1', null, e, (t ?? '') + 'z'));
check('verifyFileToken rechaza otra sesión', !verifyFileToken('king', 'sess-2', null, e, t));
check('verifyFileToken rechaza expirado', !verifyFileToken('king', 'sess-1', null, '1', t));

// URL con cid: única por comprobante, y el token queda ligado al cid.
const urlC = signFilePath('king', 'sess-1', 'cid-abc');
const qc = new URL(`https://x${urlC}`);
const ec = qc.searchParams.get('e');
const tc = qc.searchParams.get('t');
check('signFilePath con cid agrega c', qc.searchParams.get('c') === 'cid-abc');
check('verifyFileToken acepta cid correcto', verifyFileToken('king', 'sess-1', 'cid-abc', ec, tc));
check('verifyFileToken rechaza cid distinto', !verifyFileToken('king', 'sess-1', 'cid-xyz', ec, tc));
check('verifyFileToken rechaza cid faltante', !verifyFileToken('king', 'sess-1', null, ec, tc));
check('legacy window: reciente pasa', withinLegacyWindow(Date.now() - 3 * 86_400_000));
check('legacy window: 20 días no pasa', !withinLegacyWindow(Date.now() - 20 * 86_400_000));

// --- 3) rate limit ---------------------------------------------------------
delete process.env.RATE_LIMIT;
const key = `smoke-${Date.now()}`;
let ok = true;
for (let i = 0; i < 3; i++) ok = ok && rateLimit(key, 3, 60_000).ok;
check('rate limit permite hasta el límite', ok);
check('rate limit corta al superar', !rateLimit(key, 3, 60_000).ok);
process.env.RATE_LIMIT = '0';
check('rate limit kill switch (RATE_LIMIT=0)', rateLimit(`${key}-off`, 1, 60_000).ok && rateLimit(`${key}-off`, 1, 60_000).ok);

const empty = parseChatConfig({}, 'ClienteA1', 'cliente-a1');
check('brand vacío cae al nombre del tenant', empty.brandName === 'ClienteA1' && empty.primaryColor === DEFAULT_HEADER && empty.avatarUrl === null);
const filled = parseChatConfig({ brandName: 'King', primaryColor: '#112233', avatarUrl: 'https://x/a.png' }, 'Otro', 'king');
check('brand lee nombre/color/foto', filled.brandName === 'King' && filled.primaryColor === '#112233' && filled.avatarUrl === 'https://x/a.png');
const badColor = parseChatConfig({ primaryColor: 'rojo' }, 'X', 'x');
check('brand ignora color inválido', badColor.primaryColor === DEFAULT_HEADER);

console.log(failed === 0 ? '\nsmoke:wiring VERDE' : `\nsmoke:wiring ROJO (${failed} fallos)`);
process.exit(failed === 0 ? 0 : 1);

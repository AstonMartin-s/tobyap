import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { clientSettings } from '@/db/schema';
import { createPortalAccount, buildPortalName } from '@/lib/pagoda';
import { createPlayerWithRetry, buildPlayerUsername, randomPlayerPassword } from '@/lib/partner-api';
import { createUser as kingCreateUser, KingApiError } from '@/lib/king-api';
import type { ResolvedTenant } from '@/lib/types';
import {
  DEFAULT_RUNTIME,
  DEFAULT_PORTAL_URL,
  DEFAULT_SUPPORT_URL,
  DEFAULT_PORTAL_REF_IMG,
  offerCbuLine,
  offerDepositLine,
  type ChatRuntimeConfig,
  postAccreditCajeraText,
  renderTemplate,
} from '@/lib/chat/runtime';

export interface Btn { id: string; label: string }
export interface BotMsg { from: 'bot'; text?: string; copy?: string; image?: string; delayMs?: number; at: number }

// Re-export defaults (compat con imports existentes).
export const PORTAL_URL = DEFAULT_PORTAL_URL;
export const SUPPORT_URL = DEFAULT_SUPPORT_URL;
export const PORTAL_REF_IMG = DEFAULT_PORTAL_REF_IMG;

const now = () => Date.now();
const firstName = (name?: string | null) => {
  const n = (name ?? '').trim().split(/\s+/)[0];
  return n && /[a-zA-ZÀ-ÿ]/.test(n) ? n : '';
};

// Nombre que le pedimos a Pagoda: SOLO letras del nombre real (sin dígitos), así
// Pagoda tiene la mejor chance de usarlo como base del username. Si no hay letras
// usables, caemos al generador (evita mandar algo vacío).
function portalNameFrom(name?: string | null, phone?: string): string {
  const clean = (name ?? '').normalize('NFD').replace(/[^a-zA-Z]/g, '');
  if (clean.length >= 3) return clean.slice(0, 12);
  return buildPortalName(name ?? phone);
}

// ── Paso 1: WELCOME ────────────────────────────────────────────────────────
export function welcomeStep(name?: string | null, cfg: ChatRuntimeConfig = DEFAULT_RUNTIME): { messages: BotMsg[]; buttons: Btn[] } {
  const fn = firstName(name);
  const hi = fn ? `¡Hola ${fn}! 👋` : '¡Hola! 👋';
  return {
    messages: [{
      from: 'bot', delayMs: 500, at: now(),
      text: `${hi} ${renderTemplate('welcome_body', cfg)}`,
    }],
    buttons: [{ id: 'want_account', label: 'Quiero mi cuenta 🎁' }],
  };
}

// ── Paso 2: PIDIO USER (crea cuenta — Pagoda o Partner API según el tenant) ─
export async function accountStep(
  tenant: ResolvedTenant,
  session: { phone: string; name?: string | null },
  cfg: ChatRuntimeConfig = DEFAULT_RUNTIME,
): Promise<{ messages: BotMsg[]; buttons: Btn[]; data: Record<string, unknown>; step: string }> {
  if (tenant.provider === 'partner_api') return accountStepPartnerApi(tenant, session, cfg);
  // greenbet SIN Pagoda: la cuenta se crea directo por Green API.
  if (tenant.provider === 'king' && !tenant.pagodaApiKey) return accountStepKingApi(tenant, session, cfg);

  const portalName = portalNameFrom(session.name, session.phone);
  let acc;
  try {
    acc = await createPortalAccount(tenant, { phone: session.phone, name: portalName });
  } catch {
    return {
      messages: [{ from: 'bot', delayMs: 1200, at: now(), text: renderTemplate('account_error', cfg) }],
      buttons: [], data: { credsError: true }, step: 'error',
    };
  }

  const creds = `\n\n👤 Usuario: *${acc.username}*\n🔑 Contraseña: *${acc.password}*\n\n🔗 Entrá acá:\n${cfg.links.portal_login}`;
  const messages: BotMsg[] = acc.existing
    ? [
        { from: 'bot', delayMs: 600, at: now(), text: renderTemplate('account_checking', cfg) },
        { from: 'bot', delayMs: 1500, at: now(), text: renderTemplate('account_existing', cfg, { creds_block: creds }) },
      ]
    : [
        { from: 'bot', delayMs: 600, at: now(), text: renderTemplate('account_creating', cfg) },
        { from: 'bot', delayMs: 1800, at: now(), text: renderTemplate('account_done', cfg, { creds_block: creds }) },
      ];

  return {
    messages,
    buttons: [{ id: 'want_cbu', label: 'Quiero el CBU 💳' }],
    data: { username: acc.username, password: acc.password, loginUrl: acc.loginUrl, portalName, existing: acc.existing },
    step: 'credenciales',
  };
}

// Partner API (bblack/KingPlay): a diferencia de Pagoda, ACÁ nosotros elegimos
// username/password (createPlayerWithRetry reintenta con otro nombre si el
// elegido ya existe — 422 de validación). Sin magic-link: mostramos la página
// de login estable; el SSO de 60s se pide recién cuando el cliente va a jugar
// (fase de "Jugar" post-acreditación, no acá).
async function accountStepPartnerApi(
  tenant: ResolvedTenant,
  session: { phone: string; name?: string | null },
  cfg: ChatRuntimeConfig,
): Promise<{ messages: BotMsg[]; buttons: Btn[]; data: Record<string, unknown>; step: string }> {
  try {
    const { username, password } = await createPlayerWithRetry(tenant, { name: session.name, phone: session.phone });
    const creds = `\n\n👤 Usuario: *${username}*\n🔑 Contraseña: *${password}*\n\n🔗 Entrá acá:\n${cfg.links.portal_login}`;
    return {
      messages: [
        { from: 'bot', delayMs: 600, at: now(), text: renderTemplate('account_creating', cfg) },
        { from: 'bot', delayMs: 1800, at: now(), text: renderTemplate('account_done', cfg, { creds_block: creds }) },
      ],
      buttons: [{ id: 'want_cbu', label: 'Quiero el CBU 💳' }],
      data: { username, password, loginUrl: null, portalName: username, existing: false },
      step: 'credenciales',
    };
  } catch {
    return {
      messages: [{ from: 'bot', delayMs: 1200, at: now(), text: renderTemplate('account_error', cfg) }],
      buttons: [], data: { credsError: true }, step: 'error',
    };
  }
}

// Green API directa (greenbet SIN Pagoda): igual que partner_api, ACÁ generamos
// username/password y reintentamos con otro username si el elegido ya existe.
// ⚠️ El endpoint/campos de creación se confirman contra la doc de Green.
async function accountStepKingApi(
  tenant: ResolvedTenant,
  session: { phone: string; name?: string | null },
  cfg: ChatRuntimeConfig,
): Promise<{ messages: BotMsg[]; buttons: Btn[]; data: Record<string, unknown>; step: string }> {
  const password = randomPlayerPassword();
  const maxAttempts = 4;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const username = buildPlayerUsername(session.name, session.phone, attempt);
    try {
      const acc = await kingCreateUser(tenant, { username, password, phone: session.phone, name: session.name ?? undefined });
      const creds = `\n\n👤 Usuario: *${acc.username}*\n🔑 Contraseña: *${acc.password}*\n\n🔗 Entrá acá:\n${cfg.links.portal_login}`;
      return {
        messages: [
          { from: 'bot', delayMs: 600, at: now(), text: renderTemplate('account_creating', cfg) },
          { from: 'bot', delayMs: 1800, at: now(), text: renderTemplate('account_done', cfg, { creds_block: creds }) },
        ],
        buttons: [{ id: 'want_cbu', label: 'Quiero el CBU 💳' }],
        data: { username: acc.username, password: acc.password, loginUrl: null, portalName: acc.username, existing: acc.existing },
        step: 'credenciales',
      };
    } catch (e) {
      // Solo reintentamos si parece "username tomado"; otro error corta.
      const taken = e instanceof KingApiError && /exist|tomad|ya\s|duplicad|taken/i.test(e.message);
      if (!taken || attempt === maxAttempts - 1) {
        return {
          messages: [{ from: 'bot', delayMs: 1200, at: now(), text: renderTemplate('account_error', cfg) }],
          buttons: [], data: { credsError: true }, step: 'error',
        };
      }
    }
  }
  return {
    messages: [{ from: 'bot', delayMs: 1200, at: now(), text: renderTemplate('account_error', cfg) }],
    buttons: [], data: { credsError: true }, step: 'error',
  };
}

// ── Paso 3: CBU (número separado + copiar) ─────────────────────────────────
export async function cbuStep(tenant: ResolvedTenant, cfg: ChatRuntimeConfig = DEFAULT_RUNTIME): Promise<{ messages: BotMsg[]; data: Record<string, unknown>; step: string }> {
  const [s] = await db.select().from(clientSettings).where(eq(clientSettings.tenantId, tenant.id));
  const cbu = s?.accountCbu ?? '';
  const titular = s?.accountName ?? '';
  const messages: BotMsg[] = [
    { from: 'bot', delayMs: 750, at: now(), text: renderTemplate('cbu_intro', cfg, { titular }) },
  ];
  if (cbu) messages.push({ from: 'bot', delayMs: 1100, at: now(), text: cbu, copy: cbu }); // CBU solo + botón copiar
  messages.push({ from: 'bot', delayMs: 1000, at: now(), text: offerCbuLine(cfg) });
  return { messages, data: { cbu, titular }, step: 'comprobante' };
}

// ── Paso 4: comprobante recibido → GATE de app obligatorio ─────────────────
// Al subir la foto NO entra directo a revisión: primero el usuario debe instalar
// la app y activar notificaciones (paso a paso) para "terminar de enviar" el
// comprobante. Sin eso, no se envía y no puede reclamar el bono.
export function onComprobante(cfg: ChatRuntimeConfig = DEFAULT_RUNTIME): BotMsg[] {
  return [
    { from: 'bot', delayMs: 900, at: now(), text: renderTemplate('comprobante_upload_1', cfg) },
    { from: 'bot', delayMs: 1400, at: now(), text: renderTemplate('comprobante_upload_2', cfg) },
  ];
}

export function comprobanteReviewMessages(cfg: ChatRuntimeConfig = DEFAULT_RUNTIME): BotMsg[] {
  return [
    { from: 'bot', delayMs: 700, at: now(), text: renderTemplate('comprobante_review', cfg) },
  ];
}

export function comprobantePendingMessages(cfg: ChatRuntimeConfig = DEFAULT_RUNTIME): BotMsg[] {
  return [
    { from: 'bot', delayMs: 500, at: now(), text: renderTemplate('comprobante_pending', cfg) },
  ];
}

export function comprobanteRejectedMessages(cfg: ChatRuntimeConfig = DEFAULT_RUNTIME): BotMsg[] {
  return [
    { from: 'bot', delayMs: 500, at: now(), text: renderTemplate('comprobante_rejected', cfg) },
  ];
}

export function supportMessage(cfg: ChatRuntimeConfig = DEFAULT_RUNTIME): BotMsg[] {
  return [
    { from: 'bot', delayMs: 400, at: now(), text: renderTemplate('support', cfg) },
  ];
}

// ── Paso 5: CARGO — dos mensajes: acreditado + jugar, luego promo cajera/walink.
export function accreditedMessages(loginUrl?: string | null, cfg: ChatRuntimeConfig = DEFAULT_RUNTIME): BotMsg[] {
  const useMagic = cfg.magicLinks.includes('portal_play');
  const link = (useMagic && loginUrl) ? loginUrl : cfg.links.portal_play;
  const msgs: BotMsg[] = [
    { from: 'bot', delayMs: 700, at: now(), text: renderTemplate('accredited', cfg, { portal_play: link }) },
  ];
  if (cfg.postAccreditCajera) {
    msgs.push({ from: 'bot', delayMs: 1100, at: now(), text: postAccreditCajeraText(cfg) });
  }
  return msgs;
}

// Opciones post-acreditación: todo empuja a operar desde el PORTAL.
export function postActionMessages(action: string, data: Record<string, unknown>, cfg: ChatRuntimeConfig = DEFAULT_RUNTIME): { messages: BotMsg[]; step?: string } {
  const user = String(data.username ?? '');
  const pass = String(data.password ?? '');
  const loginUrl = data.loginUrl ? String(data.loginUrl) : '';
  const portalUrl = (slot: 'portal_deposit' | 'portal_withdraw' | 'portal_forgot') => {
    const useMagic = cfg.magicLinks.includes(slot);
    return (useMagic && loginUrl) ? loginUrl : cfg.links[slot];
  };
  const refImg = cfg.portalRefImg || PORTAL_REF_IMG;
  const ref = (text: string): BotMsg[] => [
    { from: 'bot', delayMs: 600, at: now(), text },
    { from: 'bot', delayMs: 900, at: now(), image: refImg },
  ];
  switch (action) {
    case 'deposit':
      return { messages: ref(renderTemplate('post_deposit', cfg, { portal_deposit: portalUrl('portal_deposit') })) };
    case 'withdraw':
      return { messages: ref(renderTemplate('post_withdraw', cfg, { portal_withdraw: portalUrl('portal_withdraw') })) };
    case 'support':
      return { messages: [{ from: 'bot', delayMs: 600, at: now(), text: renderTemplate('support', cfg) }] };
    case 'forgot_user':
      return { messages: [{ from: 'bot', delayMs: 600, at: now(), text: renderTemplate('post_forgot', cfg, { username: user, password: pass, portal_forgot: portalUrl('portal_forgot') }) }] };
    case 'cancel':
      return { messages: [{ from: 'bot', delayMs: 500, at: now(), text: '¡Gracias! Cerramos la consulta 👋 Cuando quieras, escribinos de nuevo.' }], step: 'closed' };
    default:
      return { messages: [] };
  }
}

// Detecta si el cliente está pidiendo ayuda / confundido / consulta que el flujo
// no resuelve → lo mandamos directo al soporte de WhatsApp.
const HELP_RE = /(ayuda|no entiendo|no comprendo|no puedo|no me (anda|funciona|sale)|problema|c[oó]mo hago|como funciona|no s[eé]|duda|consulta|hablar con|una persona|un humano|asesor|operador|reclamo|estafa|no me lleg|error)/i;
function supportReply(cfg: ChatRuntimeConfig = DEFAULT_RUNTIME): BotMsg[] {
  return [{ from: 'bot', delayMs: 600, at: now(), text: renderTemplate('support', cfg) }];
}

// Palabras que indican un problema real (no solo confusión con el paso de la
// app) — esas SÍ van directo a soporte incluso durante app_onboarding.
const REAL_ISSUE_RE = /(problema|reclamo|estafa|error|no me lleg|no anda|no funciona)/i;

// Confusión puntual con "la app" — muy común, no requiere soporte humano.
const APP_CONFUSION_RE = /(qu[eé] app|cu[aá]l aplicaci|qu[eé] aplicaci|c[oó]mo (la )?descargo|descargar|instalar|apk|play store|app store|me piden|tu nombre)/i;

// Cliente tipea la intención en vez de tocar el botón "Quiero mi cuenta 🎁"
// (pasa seguido en mobile). Si no lo detectamos acá, el chat queda trabado en
// 'welcome' para siempre — nunca se crea el usuario/contraseña.
export const WANT_ACCOUNT_RE = /(quiero|dame|necesito|abr[ií]|crea|hace).*(mi )?cuenta|abrir cuenta|crear cuenta|registrar(me)?|jugar|empezar|usuario y contrase/i;

export function onFreeText(step: string, text?: string, cfg: ChatRuntimeConfig = DEFAULT_RUNTIME): BotMsg[] {
  // Comprobante en revisión: acá manda el operario. El bot no responde nada
  // automático para no interferir mientras se valida — el cliente puede escribir
  // libremente y el humano interviene.
  if (step === 'validando') return [];

  const asksAboutApp = !!(text && APP_CONFUSION_RE.test(text));

  // Confusión con "la app" DURANTE el gate: la causa más común de que alguien se
  // quede trabado es no entender qué es "instalar la app" (PWA). En vez de
  // mandarlo a WhatsApp (fricción extra), le damos la salida DENTRO del chat:
  // puede saltear el paso y mandar el comprobante igual.
  if (step === 'app_onboarding' && !(text && REAL_ISSUE_RE.test(text))) {
    return [{ from: 'bot', delayMs: 600, at: now(), text: '📲 No hace falta instalar nada ahora, es opcional. Tocá *"Enviar mi imagen"* ahí abajo y seguimos con tu acreditación 🎁' }];
  }
  // Misma confusión, pero DESPUÉS de mandar el comprobante (ya pasó el gate):
  // tranquilizamos, no hace falta nada más de la app.
  if (asksAboutApp && step !== 'app_onboarding') {
    return [{ from: 'bot', delayMs: 600, at: now(), text: '✅ Tranquilo/a, no hace falta nada más con la app. Tu imagen ya quedó en proceso y en breve te acreditamos 🎉' }];
  }
  // Si pide ayuda en cualquier paso → soporte (no lo dejamos dando vueltas).
  if (text && HELP_RE.test(text)) return supportReply(cfg);
  if (step === 'welcome') return [{ from: 'bot', delayMs: 700, at: now(), text: 'Tocá el botón *Quiero mi cuenta 🎁* para empezar 👇' }];
  if (step === 'credenciales') return [{ from: 'bot', delayMs: 700, at: now(), text: 'Cuando quieras cargar, tocá *Quiero el CBU 💳* 👇' }];
  if (step === 'comprobante') return [{ from: 'bot', delayMs: 700, at: now(), text: 'Cuando tengas el comprobante de la transferencia, mandámelo por acá 📸' }];
  // Fallback: nunca dejar al cliente sin salida → soporte.
  return supportReply(cfg);
}

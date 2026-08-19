import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { clientSettings } from '@/db/schema';
import { createPortalAccount, buildPortalName } from '@/lib/pagoda';
import type { ResolvedTenant } from '@/lib/types';

export interface Btn { id: string; label: string }
export interface BotMsg { from: 'bot'; text?: string; copy?: string; image?: string; delayMs?: number; at: number }

// Imagen de referencia del portal (una sola, muestra todo: cargar/retirar/soporte).
// Se sirve desde public/. Si el archivo no existe todavía, no se muestra.
export const PORTAL_REF_IMG = '/king-portal-ref.png';

// URL fija del portal para login (marca), en vez del magic-link one-time de Pagoda.
export const PORTAL_URL = 'https://greenbet.uno/login';

// Link de soporte por WhatsApp (post-acreditación).
export const SUPPORT_URL = 'https://wa.link/jugandoconking';

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
export function welcomeStep(name?: string | null): { messages: BotMsg[]; buttons: Btn[] } {
  const fn = firstName(name);
  const hi = fn ? `¡Hola ${fn}! 👋` : '¡Hola! 👋';
  return {
    messages: [{
      from: 'bot', delayMs: 500, at: now(),
      text: `${hi} Un gusto atenderte 🎰\nBienvenido a *King*.\n\n🎁 Promo activa: *20% en tu primera carga*\n💰 Mínimo de carga: $1.000`,
    }],
    buttons: [{ id: 'want_account', label: 'Quiero mi cuenta 🎁' }],
  };
}

// ── Paso 2: PIDIO USER (crea en Pagoda) ────────────────────────────────────
export async function accountStep(
  tenant: ResolvedTenant,
  session: { phone: string; name?: string | null },
): Promise<{ messages: BotMsg[]; buttons: Btn[]; data: Record<string, unknown>; step: string }> {
  const portalName = portalNameFrom(session.name, session.phone);
  let acc;
  try {
    acc = await createPortalAccount(tenant, { phone: session.phone, name: portalName });
  } catch {
    return {
      messages: [{ from: 'bot', delayMs: 1200, at: now(), text: 'Uy, tuve un problemita con tu usuario. Un asesor te ayuda en un momento 🙌' }],
      buttons: [], data: { credsError: true }, step: 'error',
    };
  }

  const creds = `\n\n👤 Usuario: *${acc.username}*\n🔑 Contraseña: *${acc.password}*\n\n🔗 Entrá acá:\n${PORTAL_URL}`;
  const messages: BotMsg[] = acc.existing
    ? [
        { from: 'bot', delayMs: 600, at: now(), text: 'Dejame chequear tu cuenta… 👀' },
        { from: 'bot', delayMs: 1500, at: now(), text: `👋 *¡Ya tenés cuenta con nosotros!* Te la recuerdo:${creds}` },
      ]
    : [
        { from: 'bot', delayMs: 600, at: now(), text: 'Genial 🙌 Te estoy creando tu usuario, dame un segundo…' },
        { from: 'bot', delayMs: 1800, at: now(), text: `✅ *¡Felicitaciones!* Tu usuario ya está creado:${creds}` },
      ];

  return {
    messages,
    buttons: [{ id: 'want_cbu', label: 'Quiero el CBU 💳' }],
    data: { username: acc.username, password: acc.password, loginUrl: acc.loginUrl, portalName, existing: acc.existing },
    step: 'credenciales',
  };
}

// ── Paso 3: CBU (número separado + copiar) ─────────────────────────────────
export async function cbuStep(tenant: ResolvedTenant): Promise<{ messages: BotMsg[]; data: Record<string, unknown>; step: string }> {
  const [s] = await db.select().from(clientSettings).where(eq(clientSettings.tenantId, tenant.id));
  const cbu = s?.accountCbu ?? '';
  const titular = s?.accountName ?? '';
  const messages: BotMsg[] = [
    { from: 'bot', delayMs: 500, at: now(), text: `Perfecto 🙌 Datos para tu carga:\n🏦 Titular: *${titular}*` },
  ];
  if (cbu) messages.push({ from: 'bot', delayMs: 800, at: now(), text: cbu, copy: cbu }); // CBU solo + botón copiar
  messages.push({ from: 'bot', delayMs: 900, at: now(), text: 'Desde *$1.000* y te sumo *20%* 🎁 Cuando transfieras, mandame el comprobante 📸 y te acredito.' });
  return { messages, data: { cbu, titular }, step: 'comprobante' };
}

// ── Paso 4: comprobante recibido → GATE de app obligatorio ─────────────────
// Al subir la foto NO entra directo a revisión: primero el usuario debe instalar
// la app y activar notificaciones (paso a paso) para "terminar de enviar" el
// comprobante. Sin eso, no se envía y no puede reclamar el bono.
export function onComprobante(): BotMsg[] {
  return [
    { from: 'bot', delayMs: 900, at: now(), text: '¡Recibí tu comprobante! 🧾 Un último paso y lo enviamos 👇' },
    { from: 'bot', delayMs: 1400, at: now(), text: '📲 Instalá la app y activá las notificaciones — así te acreditamos más rápido y recibís tus bonos cada semana 🎁' },
  ];
}

// Cuando completa los pasos: recién ahí el comprobante entra en revisión.
export function comprobanteReviewMessages(): BotMsg[] {
  return [
    { from: 'bot', delayMs: 700, at: now(), text: '✅ ¡Listo! Tu comprobante entró en revisión 🔎 En breve validamos y te acreditamos tu saldo + bono 🎉' },
  ];
}

// Acciones manuales del operador desde el panel: comprobante pendiente / erróneo.
// (El "aprobado" reutiliza accreditedMessages.)
export function comprobantePendingMessages(): BotMsg[] {
  return [
    { from: 'bot', delayMs: 500, at: now(), text: '⏳ Estamos revisando tu comprobante. Aguardá unos minutos que ya te confirmamos la acreditación 🙌' },
  ];
}

export function comprobanteRejectedMessages(): BotMsg[] {
  return [
    { from: 'bot', delayMs: 500, at: now(), text: '⚠️ No pudimos validar el comprobante que enviaste. Revisá que se vea *completo y legible* (fecha, importe y destino) y reenvialo por acá 📸' },
  ];
}

// Mensaje de soporte / walink suelto (lo entrega el operador cuando hace falta).
export function supportMessage(): BotMsg[] {
  return [
    { from: 'bot', delayMs: 400, at: now(), text: `🙋 Para ayudarte mejor, escribinos por WhatsApp y te atendemos al toque, 24hs 👇\n${SUPPORT_URL}` },
  ];
}

// ── Paso 5: CARGO (se emite recién cuando el operador mueve el lead) ───────
// Acá SÍ usamos el magic-link de Pagoda (primer acceso directo, loguea de una).
export function accreditedMessages(loginUrl?: string | null): BotMsg[] {
  const link = loginUrl || PORTAL_URL;
  return [
    { from: 'bot', delayMs: 600, at: now(), text: `✅ *¡Acreditado con éxito!*\n🎉 ¡Gracias por elegir King! Ya tenés tu saldo.\n\n🎮 Entrá directo a jugar acá 👇\n${link}` },
    { from: 'bot', delayMs: 1200, at: now(), text: '¿Necesitás algo más? Elegí una opción 👇' },
  ];
}

// Opciones post-acreditación: todo empuja a operar desde el PORTAL.
export function postActionMessages(action: string, data: Record<string, unknown>): { messages: BotMsg[]; step?: string } {
  const user = String(data.username ?? '');
  const pass = String(data.password ?? '');
  // Post-acreditación: siempre el magic-link de Pagoda (acceso directo).
  const url = String(data.loginUrl || PORTAL_URL);
  const portal = `\n${url}`;
  const ref = (text: string): BotMsg[] => [
    { from: 'bot', delayMs: 600, at: now(), text },
    { from: 'bot', delayMs: 900, at: now(), image: PORTAL_REF_IMG },
  ];
  switch (action) {
    case 'deposit':
      return { messages: ref(`💰 *Cargar saldo*\nEntrá al portal y tocá *"Cargar saldo"* 👇${portal}\n\nMínimo *$1.000* y se bonifica un *20%* 🎁`) };
    case 'withdraw':
      return { messages: ref(`💸 *Retirar saldo*\nEntrá al portal y tocá *"Retirar saldo"* 👇${portal}\n\nCargá tu CBU en "Mi cuenta bancaria" y listo.`) };
    case 'support':
      return { messages: [{ from: 'bot', delayMs: 600, at: now(), text: `🙋 *Soporte*\nEscribinos por WhatsApp y te atendemos al toque, 24hs 👇\n${SUPPORT_URL}` }] };
    case 'forgot_user':
      return { messages: [{ from: 'bot', delayMs: 600, at: now(), text: `🔐 Tus datos de acceso:\n\n👤 Usuario: *${user}*\n🔑 Contraseña: *${pass}*\n\n🔗 Entrá directo acá 👇${portal}` }] };
    case 'cancel':
      return { messages: [{ from: 'bot', delayMs: 500, at: now(), text: '¡Gracias! Cerramos la consulta 👋 Cuando quieras, escribinos de nuevo.' }], step: 'closed' };
    default:
      return { messages: [] };
  }
}

export function onFreeText(step: string): BotMsg[] {
  if (step === 'welcome') return [{ from: 'bot', delayMs: 700, at: now(), text: 'Tocá el botón *Quiero mi cuenta 🎁* para empezar 👇' }];
  if (step === 'credenciales') return [{ from: 'bot', delayMs: 700, at: now(), text: 'Cuando quieras cargar, tocá *Quiero el CBU 💳* 👇' }];
  if (step === 'comprobante') return [{ from: 'bot', delayMs: 700, at: now(), text: 'Cuando tengas el comprobante de la transferencia, mandámelo por acá 📸' }];
  // Regla: NUNCA dejar al cliente sin una salida. Cualquier texto libre para el que
  // no tengamos respuesta scripteada siempre ofrece un camino (soporte por WhatsApp).
  return [{ from: 'bot', delayMs: 700, at: now(), text: `Te leemos 🙌 Para ayudarte al toque, escribinos por WhatsApp y te respondemos ya 👇\n${SUPPORT_URL}` }];
}

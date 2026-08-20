// Config de guion del chat (oferta, links). Vive en client_settings.chat_config.
// flow.ts lee esto con fallback a los valores actuales de King — sin config = igual que hoy.

export type OfferType = 'bonus' | 'fichas';

export const LINK_SLOT_IDS = [
  'portal_login',
  'portal_forgot',
  'portal_play',
  'portal_deposit',
  'portal_withdraw',
  'support',
] as const;

export type LinkSlotId = typeof LINK_SLOT_IDS[number];

export interface ChatRuntimeConfig {
  brandName: string;
  offerType: OfferType;
  offerValue: number;
  minDeposit: number;
  portalRefImg: string;
  links: Record<LinkSlotId, string>;
}

export const DEFAULT_PORTAL_URL = 'https://greenbet.uno/login';
export const DEFAULT_SUPPORT_URL = 'https://wa.link/jugandoconking';
export const DEFAULT_PORTAL_REF_IMG = '/king-portal-ref.png';

export const DEFAULT_LINKS: Record<LinkSlotId, string> = {
  portal_login: DEFAULT_PORTAL_URL,
  portal_forgot: DEFAULT_PORTAL_URL,
  portal_play: DEFAULT_PORTAL_URL,
  portal_deposit: DEFAULT_PORTAL_URL,
  portal_withdraw: DEFAULT_PORTAL_URL,
  support: DEFAULT_SUPPORT_URL,
};

/** Metadatos para el panel: un link por mensaje del guion. */
export const LINK_SLOTS: Array<{ id: LinkSlotId; label: string; hint: string }> = [
  { id: 'portal_login', label: 'Credenciales (cuenta nueva)', hint: 'Al crear usuario o mostrar usuario y contraseña' },
  { id: 'portal_forgot', label: 'Recordar datos (olvidé usuario)', hint: 'Botón Datos del operador o “olvide mi usuario”' },
  { id: 'portal_play', label: 'Acreditado — entrar a jugar', hint: 'Tras acreditar; si Pagoda da magic-link, usa ese primero' },
  { id: 'portal_deposit', label: 'Cargar saldo', hint: 'Menú post-acreditación o botón Cargar' },
  { id: 'portal_withdraw', label: 'Retirar saldo', hint: 'Menú post-acreditación o botón Retirar' },
  { id: 'support', label: 'Soporte WhatsApp', hint: 'Ayuda humana, walink o consultas' },
];

export type PreviewBubble = { step: string; who: 'bot' | 'user'; text: string; linkSlot?: LinkSlotId };

export const DEFAULT_RUNTIME: ChatRuntimeConfig = {
  brandName: 'King',
  offerType: 'bonus',
  offerValue: 30,
  minDeposit: 1000,
  portalRefImg: DEFAULT_PORTAL_REF_IMG,
  links: { ...DEFAULT_LINKS },
};

function clampNum(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function cleanUrl(v: unknown, fallback: string): string {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) return fallback;
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return fallback;
    return s;
  } catch {
    return fallback;
  }
}

function parseLinks(raw: unknown, legacyPortal?: unknown, legacySupport?: unknown): Record<LinkSlotId, string> {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const nested = o.links && typeof o.links === 'object' && !Array.isArray(o.links)
    ? (o.links as Record<string, unknown>)
    : {};
  const portalFallback = cleanUrl(legacyPortal ?? o.portalUrl, DEFAULT_PORTAL_URL);
  const supportFallback = cleanUrl(legacySupport ?? o.supportUrl, DEFAULT_SUPPORT_URL);
  const links = { ...DEFAULT_LINKS };
  for (const id of LINK_SLOT_IDS) {
    const fallback = id === 'support' ? supportFallback : portalFallback;
    links[id] = cleanUrl(nested[id], fallback);
  }
  return links;
}

export function parseChatRuntime(raw: unknown, fallbackBrand = 'King'): ChatRuntimeConfig {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const brandName = typeof o.brandName === 'string' && o.brandName.trim() ? o.brandName.trim() : fallbackBrand;
  const offerType: OfferType = o.offerType === 'fichas' ? 'fichas' : 'bonus';
  const refImg = typeof o.portalRefImg === 'string' && o.portalRefImg.trim() ? o.portalRefImg.trim() : DEFAULT_PORTAL_REF_IMG;
  return {
    brandName,
    offerType,
    offerValue: clampNum(o.offerValue, 1, 999999, DEFAULT_RUNTIME.offerValue),
    minDeposit: clampNum(o.minDeposit, 100, 50_000_000, DEFAULT_RUNTIME.minDeposit),
    portalRefImg: refImg.startsWith('/') ? refImg : DEFAULT_PORTAL_REF_IMG,
    links: parseLinks(o),
  };
}

function money(n: number): string {
  return n.toLocaleString('es-AR');
}

export function offerWelcomeLine(cfg: ChatRuntimeConfig): string {
  const promo = cfg.offerType === 'bonus'
    ? `🎁 Promo activa: *${cfg.offerValue}% en tu primera carga*`
    : `🎁 Promo activa: *${cfg.offerValue} fichas gratis*`;
  return `${promo}\n💰 Mínimo de carga: $${money(cfg.minDeposit)}`;
}

export function offerCbuLine(cfg: ChatRuntimeConfig): string {
  if (cfg.offerType === 'bonus') {
    return `Desde *$${money(cfg.minDeposit)}* y te sumo *${cfg.offerValue}%* 🎁 Cuando transfieras, mandame el comprobante 📸 y te acredito.`;
  }
  return `Desde *$${money(cfg.minDeposit)}* y te sumamos *${cfg.offerValue} fichas gratis* 🎁 Cuando transfieras, mandame el comprobante 📸 y te acredito.`;
}

export function offerDepositLine(cfg: ChatRuntimeConfig): string {
  const bonus = cfg.offerType === 'bonus'
    ? `se bonifica un *${cfg.offerValue}%*`
    : `sumamos *${cfg.offerValue} fichas gratis*`;
  return `Mínimo *$${money(cfg.minDeposit)}* y ${bonus} 🎁`;
}

/** Vista previa del guion modelo (panel) — muestra dónde va cada link. */
export function buildConversationPreview(cfg: ChatRuntimeConfig, sampleName = 'Martín'): PreviewBubble[] {
  const fn = sampleName.split(/\s+/)[0];
  const L = cfg.links;
  return [
    { step: 'welcome', who: 'bot', text: `¡Hola ${fn}! 👋\nBienvenido a *${cfg.brandName}*.\n${offerWelcomeLine(cfg)}` },
    { step: 'welcome', who: 'user', text: 'Quiero mi cuenta 🎁' },
    { step: 'credenciales', who: 'bot', text: `✅ Tu usuario ya está creado:\n👤 Usuario: *martin123*\n🔑 Contraseña: *••••*\n\n🔗 Entrá acá:\n${L.portal_login}`, linkSlot: 'portal_login' },
    { step: 'cbu', who: 'bot', text: `Perfecto 🙌 Datos para tu carga:\n🏦 Titular: *Titular CBU*\n[CBU del panel]\n${offerCbuLine(cfg)}` },
    { step: 'comprobante', who: 'user', text: '📷 [comprobante]' },
    { step: 'validando', who: 'bot', text: '✅ Tu comprobante entró en revisión 🔎 En breve validamos y te acreditamos…' },
    { step: 'done', who: 'bot', text: `✅ *¡Acreditado con éxito!*\n🎉 ¡Gracias por elegir ${cfg.brandName}!\n\n🎮 Entrá directo a jugar acá 👇\n${L.portal_play}`, linkSlot: 'portal_play' },
    { step: 'forgot', who: 'bot', text: `🔐 Tus datos de acceso:\n\n👤 Usuario: *martin123*\n🔑 Contraseña: *••••*\n\n🔗 Entrá directo acá 👇\n${L.portal_forgot}`, linkSlot: 'portal_forgot' },
    { step: 'deposit', who: 'bot', text: `💰 *Cargar saldo*\nEntrá al portal y tocá *"Cargar saldo"* 👇\n${L.portal_deposit}\n\n${offerDepositLine(cfg)}`, linkSlot: 'portal_deposit' },
    { step: 'withdraw', who: 'bot', text: `💸 *Retirar saldo*\nEntrá al portal 👇\n${L.portal_withdraw}`, linkSlot: 'portal_withdraw' },
    { step: 'support', who: 'bot', text: `🙋 *Soporte*\nEscribinos por WhatsApp 👇\n${L.support}`, linkSlot: 'support' },
  ];
}

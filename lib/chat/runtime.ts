// Config de guion del chat (oferta, links). Vive en client_settings.chat_config.
// flow.ts lee esto con fallback a los valores actuales de King — sin config = igual que hoy.

export type OfferType = 'bonus' | 'fichas';

export interface ChatRuntimeConfig {
  brandName: string;
  offerType: OfferType;
  offerValue: number;
  minDeposit: number;
  portalUrl: string;
  supportUrl: string;
  portalRefImg: string;
}

export const DEFAULT_PORTAL_URL = 'https://greenbet.uno/login';
export const DEFAULT_SUPPORT_URL = 'https://wa.link/jugandoconking';
export const DEFAULT_PORTAL_REF_IMG = '/king-portal-ref.png';

export const DEFAULT_RUNTIME: ChatRuntimeConfig = {
  brandName: 'King',
  offerType: 'bonus',
  offerValue: 30,
  minDeposit: 1000,
  portalUrl: DEFAULT_PORTAL_URL,
  supportUrl: DEFAULT_SUPPORT_URL,
  portalRefImg: DEFAULT_PORTAL_REF_IMG,
};

/** Metadatos para el panel: dónde aparece cada link en el guion. */
export const LINK_SLOTS = [
  { id: 'portal_login', label: 'Login al portal (credenciales / recordar datos)', field: 'portalUrl' as const },
  { id: 'portal_play', label: 'Acreditado — entrar a jugar', field: 'portalUrl' as const },
  { id: 'portal_deposit', label: 'Cargar saldo (post-acreditación)', field: 'portalUrl' as const },
  { id: 'portal_withdraw', label: 'Retirar saldo', field: 'portalUrl' as const },
  { id: 'support', label: 'Soporte WhatsApp', field: 'supportUrl' as const },
];

export type PreviewBubble = { step: string; who: 'bot' | 'user'; text: string; linkField?: 'portalUrl' | 'supportUrl' };

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
    portalUrl: cleanUrl(o.portalUrl, DEFAULT_PORTAL_URL),
    supportUrl: cleanUrl(o.supportUrl, DEFAULT_SUPPORT_URL),
    portalRefImg: refImg.startsWith('/') ? refImg : DEFAULT_PORTAL_REF_IMG,
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
  const portal = cfg.portalUrl;
  const support = cfg.supportUrl;
  return [
    { step: 'welcome', who: 'bot', text: `¡Hola ${fn}! 👋\nBienvenido a *${cfg.brandName}*.\n${offerWelcomeLine(cfg)}` },
    { step: 'welcome', who: 'user', text: 'Quiero mi cuenta 🎁' },
    { step: 'credenciales', who: 'bot', text: `✅ Tu usuario ya está creado:\n👤 Usuario: *martin123*\n🔑 Contraseña: *••••*\n\n🔗 Entrá acá:\n${portal}`, linkField: 'portalUrl' },
    { step: 'cbu', who: 'bot', text: `Perfecto 🙌 Datos para tu carga:\n🏦 Titular: *Titular CBU*\n[CBU del panel]\n${offerCbuLine(cfg)}` },
    { step: 'comprobante', who: 'user', text: '📷 [comprobante]' },
    { step: 'validando', who: 'bot', text: '✅ Tu comprobante entró en revisión 🔎 En breve validamos y te acreditamos…' },
    { step: 'done', who: 'bot', text: `✅ *¡Acreditado con éxito!*\n🎉 ¡Gracias por elegir ${cfg.brandName}!\n\n🎮 Entrá directo a jugar acá 👇\n${portal}`, linkField: 'portalUrl' },
    { step: 'deposit', who: 'bot', text: `💰 *Cargar saldo*\nEntrá al portal y tocá *"Cargar saldo"* 👇\n${portal}\n\n${offerDepositLine(cfg)}`, linkField: 'portalUrl' },
    { step: 'withdraw', who: 'bot', text: `💸 *Retirar saldo*\nEntrá al portal 👇\n${portal}`, linkField: 'portalUrl' },
    { step: 'support', who: 'bot', text: `🙋 *Soporte*\nEscribinos por WhatsApp 👇\n${support}`, linkField: 'supportUrl' },
  ];
}

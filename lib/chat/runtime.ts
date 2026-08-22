// Config de guion del chat (oferta, links). Vive en client_settings.chat_config.
// flow.ts lee esto con fallback a los valores actuales de King — sin config = igual que hoy.

import type { MessageTemplateId, PanelQuickTexts } from '@/lib/chat/templates';
import { DEFAULT_TEMPLATES, parsePanelQuick, parseTemplates } from '@/lib/chat/templates';

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
  magicLinks: LinkSlotId[];
  /** Mensaje extra post-acreditación (cajera + link soporte). */
  postAccreditCajera?: boolean;
  /** Textos del guion (override por tenant). */
  templates?: Partial<Record<MessageTemplateId, string>>;
  /** Placeholder y atajos de la barra del operador en Chats. */
  panelQuick?: PanelQuickTexts;
}

export const DEFAULT_PORTAL_URL = 'https://greenbet.uno/login';
export const DEFAULT_SUPPORT_URL = 'https://wa.link/jugandoconking';
export const DEFAULT_PORTAL_REF_IMG = '/king-portal-ref.png';
/** Ejemplo visual en panel — en prod Pagoda devuelve uno distinto por usuario. */
export const PAGODA_MAGIC_URL_SAMPLE = 'https://greenbet.dat4win.com/entrar/…';

export const DEFAULT_LINKS: Record<LinkSlotId, string> = {
  portal_login: DEFAULT_PORTAL_URL,
  portal_forgot: DEFAULT_PORTAL_URL,
  portal_play: DEFAULT_PORTAL_URL,
  portal_deposit: DEFAULT_PORTAL_URL,
  portal_withdraw: DEFAULT_PORTAL_URL,
  support: DEFAULT_SUPPORT_URL,
};

/** Metadatos para el panel: un link por mensaje del guion. */
export const LINK_SLOTS: Array<{
  id: LinkSlotId;
  label: string;
  hint: string;
  kind: 'static' | 'magic_fallback';
}> = [
  {
    id: 'portal_login',
    label: 'Credenciales (cuenta nueva)',
    hint: 'Automático al crear cuenta. Siempre la página fija del portal (greenbet.uno), no el magic-link de Pagoda.',
    kind: 'static',
  },
  {
    id: 'portal_play',
    label: 'Acreditado — entrar a jugar',
    hint: 'Automático al aprobar. En prod usa el magic-link Pagoda (dat4win) guardado en la sesión; abajo = fallback si no hay.',
    kind: 'magic_fallback',
  },
  {
    id: 'portal_forgot',
    label: 'Recordar datos (botón Datos)',
    hint: 'Operador u “olvide mi usuario”. Magic-link Pagoda si existe en la sesión; abajo = fallback.',
    kind: 'magic_fallback',
  },
  {
    id: 'portal_deposit',
    label: 'Cargar saldo',
    hint: 'Botón Cargar del operador o menú post-acreditación. Magic-link Pagoda si existe; abajo = fallback.',
    kind: 'magic_fallback',
  },
  {
    id: 'portal_withdraw',
    label: 'Retirar saldo',
    hint: 'Botón Retirar del operador. Magic-link Pagoda si existe; abajo = fallback.',
    kind: 'magic_fallback',
  },
  {
    id: 'support',
    label: 'Soporte WhatsApp',
    hint: 'Automático (ayuda en texto libre) o botón Soporte del operador.',
    kind: 'static',
  },
];

export type PreviewBubble = {
  step: string;
  who: 'bot' | 'user';
  text: string;
  linkSlot?: LinkSlotId;
  linkMagic?: boolean;
};

export const DEFAULT_RUNTIME: ChatRuntimeConfig = {
  brandName: 'King',
  offerType: 'bonus',
  offerValue: 30,
  minDeposit: 1000,
  portalRefImg: DEFAULT_PORTAL_REF_IMG,
  links: { ...DEFAULT_LINKS },
  magicLinks: ['portal_play', 'portal_forgot', 'portal_deposit', 'portal_withdraw'],
  postAccreditCajera: true,
};

export function postAccreditCajeraText(cfg: ChatRuntimeConfig): string {
  return renderTemplate('accredited_cajera', cfg);
}

export function renderTemplate(
  id: MessageTemplateId,
  cfg: ChatRuntimeConfig,
  vars: Record<string, string> = {},
): string {
  const raw = cfg.templates?.[id]?.trim() || DEFAULT_TEMPLATES[id];
  const map: Record<string, string> = {
    brand: cfg.brandName,
    support: cfg.links.support,
    portal_login: cfg.links.portal_login,
    portal_play: vars.portal_play ?? cfg.links.portal_play,
    portal_deposit: vars.portal_deposit ?? cfg.links.portal_deposit,
    portal_withdraw: vars.portal_withdraw ?? cfg.links.portal_withdraw,
    portal_forgot: vars.portal_forgot ?? cfg.links.portal_forgot,
    offer_welcome: offerWelcomeLine(cfg),
    offer_deposit: offerDepositLine(cfg),
    offer_cbu: offerCbuLine(cfg),
    titular: vars.titular ?? '',
    cbu: vars.cbu ?? '',
    username: vars.username ?? '',
    password: vars.password ?? '',
    creds_block: vars.creds_block ?? '',
    ...vars,
  };
  return raw.replace(/\{(\w+)\}/g, (_, key: string) => map[key] ?? `{${key}}`);
}

/** Link de soporte del chat: siempre landing walink (rotación), nunca wa.me directo. */
export function walinkSupportUrl(slug: string, landingOrigin?: string): string {
  const raw = (landingOrigin || process.env.NEXT_PUBLIC_LANDING_ORIGIN || 'https://go.fichaslibres.online').trim();
  const host = raw.replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  return `https://${host}/l/${slug}/walink?campaign=Soporte`;
}

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
  const isLinkSlot = (x: unknown): x is LinkSlotId => typeof x === 'string' && LINK_SLOT_IDS.includes(x as LinkSlotId);
  const magicLinks = (Array.isArray(o.magicLinks)
    ? o.magicLinks.filter(isLinkSlot)
    : ['portal_play', 'portal_forgot', 'portal_deposit', 'portal_withdraw']) as LinkSlotId[];
  return {
    brandName,
    offerType,
    offerValue: clampNum(o.offerValue, 1, 999999, DEFAULT_RUNTIME.offerValue),
    minDeposit: clampNum(o.minDeposit, 100, 50_000_000, DEFAULT_RUNTIME.minDeposit),
    portalRefImg: refImg.startsWith('/') ? refImg : DEFAULT_PORTAL_REF_IMG,
    links: parseLinks(o),
    magicLinks,
    postAccreditCajera: o.postAccreditCajera !== false,
    templates: parseTemplates(o.templates),
    panelQuick: parsePanelQuick(o.panelQuick),
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
    return `Desde *$${money(cfg.minDeposit)}* y te sumo *${cfg.offerValue}%* 🎁 Espero tu comprobante!`;
  }
  return `Desde *$${money(cfg.minDeposit)}* y te sumamos *${cfg.offerValue} fichas gratis* 🎁 Espero tu comprobante!`;
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
  const m = (slot: LinkSlotId) => cfg.magicLinks.includes(slot) ? PAGODA_MAGIC_URL_SAMPLE : L[slot];
  const isM = (slot: LinkSlotId) => cfg.magicLinks.includes(slot);
  return [
    { step: 'welcome', who: 'bot', text: `¡Hola ${fn}! 👋\nBienvenido a *${cfg.brandName}*.\n${offerWelcomeLine(cfg)}` },
    { step: 'welcome', who: 'user', text: 'Quiero mi cuenta 🎁' },
    { step: 'credenciales', who: 'bot', text: `✅ Tu usuario ya está creado:\n👤 Usuario: *martin123*\n🔑 Contraseña: *••••*\n\n🔗 Entrá acá:\n${L.portal_login}`, linkSlot: 'portal_login' },
    { step: 'cbu', who: 'bot', text: `Perfecto 🙌 Datos para tu carga:\n🏦 Titular: *Titular CBU*\n[CBU del panel]\n${offerCbuLine(cfg)}` },
    { step: 'comprobante', who: 'user', text: '📷 [comprobante]' },
    { step: 'validando', who: 'bot', text: '✅ Tu imagen entró en revisión 🔎 En breve validamos y te acreditamos…' },
    { step: 'done', who: 'bot', text: `✅ *¡Acreditado con éxito!*\n🎉 ¡Gracias por elegir ${cfg.brandName}! Ya tenés tu saldo.\n\n🎮 Entrá directo a jugar acá 👇\n${m('portal_play')}`, linkSlot: 'portal_play', linkMagic: isM('portal_play') },
    ...(cfg.postAccreditCajera ? [{ step: 'done' as const, who: 'bot' as const, text: postAccreditCajeraText(cfg), linkSlot: 'support' as const }] : []),
    { step: 'forgot', who: 'bot', text: `🔐 Tus datos de acceso:\n\n👤 Usuario: *martin123*\n🔑 Contraseña: *••••*\n\n🔗 Entrá directo acá 👇\n${m('portal_forgot')}`, linkSlot: 'portal_forgot', linkMagic: isM('portal_forgot') },
    { step: 'deposit', who: 'bot', text: `💰 *Cargar saldo*\nEntrá al portal y tocá *"Cargar saldo"* 👇\n${m('portal_deposit')}\n\n${offerDepositLine(cfg)}`, linkSlot: 'portal_deposit', linkMagic: isM('portal_deposit') },
    { step: 'withdraw', who: 'bot', text: `💸 *Retirar saldo*\nEntrá al portal 👇\n${m('portal_withdraw')}`, linkSlot: 'portal_withdraw', linkMagic: isM('portal_withdraw') },
    { step: 'support', who: 'bot', text: `🙋 *Soporte*\nEscribinos por WhatsApp 👇\n${L.support}`, linkSlot: 'support' },
  ];
}

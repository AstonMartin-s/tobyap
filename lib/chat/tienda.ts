// Config del nicho TIENDA (ecommerce). Data-driven: el cliente define su proceso
// de venta en el onboarding ("Producto", "Pago", "Entrega") y el guion se arma a
// partir de esto — nada hardcodeado por cliente. Vive en client_settings.chat_config
// bajo la clave `tienda` (aditivo; no interfiere con la piel de Circo).
//
// El flujo (lib/chat/flows/tienda.ts) y la UI de onboarding (front, Claude) leen y
// escriben esta estructura vía parseTiendaConfig.

export type PaymentMethodType = 'transfer' | 'payment_link' | 'other';
export type DeliveryMode = 'link' | 'email' | 'manual';

// Un producto vendible. `deliveryUrl` = link de descarga/acceso que se entrega al
// liberar el producto (si delivery.mode === 'link').
export interface TiendaProduct {
  id: string;
  name: string;
  price: number;
  currency: string; // ISO-4217, default 'ARS'
  description?: string;
  deliveryUrl?: string;
  active: boolean;
}

// Método de pago que el cliente HABILITA en el onboarding. `data` = CBU/alias
// (transfer) o URL del checkout (payment_link).
export interface TiendaPaymentMethod {
  type: PaymentMethodType;
  enabled: boolean;
  label?: string;
  data?: string;
}

export interface TiendaDelivery {
  // 'link'   → se manda deliveryUrl del producto en el chat al confirmar.
  // 'email'  → se pide/usa email y el operario/proceso lo envía por correo.
  // 'manual' → el operario lo entrega a mano; nosotros solo disparamos Purchase.
  mode: DeliveryMode;
  note?: string;
}

export interface TiendaConfig {
  brandName: string;
  currency: string; // moneda por defecto de la tienda
  products: TiendaProduct[];
  payments: TiendaPaymentMethod[];
  delivery: TiendaDelivery;
  supportUrl: string;
}

export const DEFAULT_TIENDA_DELIVERY: TiendaDelivery = { mode: 'link' };

export const DEFAULT_TIENDA_CONFIG: TiendaConfig = {
  brandName: 'Tienda',
  currency: 'ARS',
  products: [],
  payments: [
    { type: 'transfer', enabled: true, label: 'Transferencia' },
  ],
  delivery: { ...DEFAULT_TIENDA_DELIVERY },
  supportUrl: '',
};

const PAYMENT_TYPES: PaymentMethodType[] = ['transfer', 'payment_link', 'other'];
const DELIVERY_MODES: DeliveryMode[] = ['link', 'email', 'manual'];

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' && v.trim() ? v.trim() : fallback;
}

function num(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function cleanUrl(v: unknown): string {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) return '';
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:' ? s : '';
  } catch {
    return '';
  }
}

function parseProduct(raw: unknown, i: number, defCurrency: string): TiendaProduct | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const name = str(o.name);
  if (!name) return null;
  return {
    id: str(o.id) || `p${i + 1}`,
    name,
    price: num(o.price),
    currency: str(o.currency, defCurrency),
    description: str(o.description) || undefined,
    deliveryUrl: cleanUrl(o.deliveryUrl) || undefined,
    active: o.active !== false,
  };
}

function parsePayment(raw: unknown): TiendaPaymentMethod | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const type = PAYMENT_TYPES.includes(o.type as PaymentMethodType) ? (o.type as PaymentMethodType) : 'other';
  return {
    type,
    enabled: o.enabled !== false,
    label: str(o.label) || undefined,
    data: str(o.data) || undefined,
  };
}

// Extrae y valida la config Tienda desde chat_config.tienda (o el objeto crudo).
export function parseTiendaConfig(raw: unknown, fallbackBrand = 'Tienda'): TiendaConfig {
  const root = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const o = (root.tienda && typeof root.tienda === 'object' && !Array.isArray(root.tienda)
    ? (root.tienda as Record<string, unknown>)
    : root) as Record<string, unknown>;

  const currency = str(o.currency, DEFAULT_TIENDA_CONFIG.currency);
  const products = Array.isArray(o.products)
    ? o.products.map((p, i) => parseProduct(p, i, currency)).filter((p): p is TiendaProduct => !!p)
    : [];
  const payments = Array.isArray(o.payments)
    ? o.payments.map(parsePayment).filter((p): p is TiendaPaymentMethod => !!p)
    : [...DEFAULT_TIENDA_CONFIG.payments];

  const deliveryRaw = (o.delivery && typeof o.delivery === 'object' && !Array.isArray(o.delivery)
    ? (o.delivery as Record<string, unknown>)
    : {}) as Record<string, unknown>;
  const mode = DELIVERY_MODES.includes(deliveryRaw.mode as DeliveryMode)
    ? (deliveryRaw.mode as DeliveryMode)
    : DEFAULT_TIENDA_DELIVERY.mode;

  return {
    brandName: str(o.brandName, fallbackBrand),
    currency,
    products,
    payments: payments.length ? payments : [...DEFAULT_TIENDA_CONFIG.payments],
    delivery: { mode, note: str(deliveryRaw.note) || undefined },
    supportUrl: cleanUrl(o.supportUrl),
  };
}

export function enabledPayments(cfg: TiendaConfig): TiendaPaymentMethod[] {
  return cfg.payments.filter((p) => p.enabled);
}

export function activeProducts(cfg: TiendaConfig): TiendaProduct[] {
  return cfg.products.filter((p) => p.active);
}

export function findProduct(cfg: TiendaConfig, id: string): TiendaProduct | undefined {
  return cfg.products.find((p) => p.id === id);
}

export function formatPrice(price: number, currency: string): string {
  const n = price.toLocaleString('es-AR');
  return currency === 'ARS' ? `$${n}` : `${n} ${currency}`;
}

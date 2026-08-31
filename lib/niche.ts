// Nicho de un cliente: la gran rama de negocio a la que pertenece. Determina el
// proceso de venta y el guion del chat. Es aditivo: todos los clientes existentes
// caen en 'circo' (casino/apuestas, todo lo trabajado hasta hoy) por defecto.
//
// - circo:  casino/apuestas. Flujo actual (cuenta portal → CBU → comprobante →
//           acreditación → jugar). Provider pagoda/partner_api/king.
// - tienda: ecommerce (ej. venta de ebooks). Proceso de venta distinto; se
//           implementa por encima de esta categorización, sin tocar circo.

export const NICHES = ['circo', 'tienda'] as const;

export type Niche = (typeof NICHES)[number];

export const DEFAULT_NICHE: Niche = 'circo';

export interface NicheMeta {
  id: Niche;
  label: string;
  description: string;
}

export const NICHE_META: Record<Niche, NicheMeta> = {
  circo: {
    id: 'circo',
    label: 'Circo',
    description: 'Casino / apuestas. Cuenta de portal → CBU → comprobante → acreditación → jugar.',
  },
  tienda: {
    id: 'tienda',
    label: 'Tienda',
    description: 'Ecommerce (ej. ebooks). Catálogo → compra → pago → entrega.',
  },
};

// ---------------------------------------------------------------------------
// Vocabulario de eventos a Meta por nicho. Las dos ranuras lógicas del sistema
// (conversation = inicia conversación · conversion = venta/cargo) se traducen a
// nombres de evento distintos según el nicho:
//  - circo:  ConversacionCRM<suffix> / CargoCRM<suffix> (comportamiento actual).
//  - tienda: Contact / Purchase (eventos ESTÁNDAR de Meta, SIN sufijo CRM), para
//            trackear conversación de sitio web + conversión personalizada.
// `standard=true` => nombre fijo de Meta, no se le agrega el sufijo del tenant.
// ---------------------------------------------------------------------------
export type EventSlot = 'conversation' | 'conversion';

export interface NicheEventName {
  base: string;
  standard: boolean;
}

export const NICHE_EVENTS: Record<Niche, Record<EventSlot, NicheEventName>> = {
  circo: {
    conversation: { base: 'Conversacion', standard: false },
    conversion: { base: 'Cargo', standard: false },
  },
  tienda: {
    conversation: { base: 'Contact', standard: true },
    conversion: { base: 'Purchase', standard: true },
  },
};

export function isNiche(v: unknown): v is Niche {
  return typeof v === 'string' && (NICHES as readonly string[]).includes(v);
}

/** Normaliza cualquier valor a un nicho válido, cayendo a 'circo' si no coincide. */
export function parseNiche(v: unknown): Niche {
  return isNiche(v) ? v : DEFAULT_NICHE;
}

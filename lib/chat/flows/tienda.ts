// Guion del chat web para el nicho TIENDA (ecommerce). Se arma desde TiendaConfig
// (productos / pago / entrega) — nada hardcodeado por cliente. Análogo a flow.ts
// (Circo) pero SIN cuenta portal, CBU, ficha ni acreditación: acá es
// bienvenida → producto → pago → comprobante → (operario libera producto) → entrega.
//
// Pasos de sesión (chatSessions.step):
//   welcome | pago | comprobante | validando | done
//
// Los botones de producto usan action `buy:<id>` (los despacha action/route.ts).
import type { BotMsg, Btn } from '@/lib/chat/flow';
import {
  activeProducts,
  enabledPayments,
  findProduct,
  formatPrice,
  type TiendaConfig,
  type TiendaPaymentMethod,
} from '@/lib/chat/tienda';

const now = () => Date.now();

function firstName(name?: string | null): string {
  const n = (name ?? '').trim().split(/\s+/)[0];
  return n && /[a-zA-ZÀ-ÿ]/.test(n) ? n : '';
}

export const BUY_ACTION_PREFIX = 'buy:';

/** Botón por cada producto activo. */
export function productButtons(cfg: TiendaConfig): Btn[] {
  return activeProducts(cfg).map((p) => ({
    id: `${BUY_ACTION_PREFIX}${p.id}`,
    label: `${p.name} — ${formatPrice(p.price, p.currency || cfg.currency)}`,
  }));
}

// ── Paso 1: WELCOME ────────────────────────────────────────────────────────
export function welcomeStepTienda(name: string | null | undefined, cfg: TiendaConfig): { messages: BotMsg[]; buttons: Btn[] } {
  const fn = firstName(name);
  const hi = fn ? `¡Hola ${fn}! 👋` : '¡Hola! 👋';
  const prods = activeProducts(cfg);
  if (!prods.length) {
    return {
      messages: [{
        from: 'bot', delayMs: 500, at: now(),
        text: `${hi} Bienvenido a *${cfg.brandName}* 🛍️\nEn un momento un asesor te atiende.`,
      }],
      buttons: [],
    };
  }
  return {
    messages: [{
      from: 'bot', delayMs: 500, at: now(),
      text: `${hi} Bienvenido a *${cfg.brandName}* 🛍️\nMirá lo que tenemos y elegí para comprar 👇`,
    }],
    buttons: productButtons(cfg),
  };
}

function paymentLine(pm: TiendaPaymentMethod): string {
  const data = pm.data?.trim();
  switch (pm.type) {
    case 'transfer':
      return data
        ? `🏦 *Transferencia*\nCBU/Alias: *${data}*`
        : `🏦 *Transferencia* (te pasamos los datos por acá)`;
    case 'payment_link':
      return data
        ? `💳 *Link de pago*\nPagá acá 👇\n${data}`
        : `💳 *Link de pago* (te lo enviamos por acá)`;
    default:
      return data ? `💠 ${pm.label ?? 'Otro medio'}: ${data}` : `💠 ${pm.label ?? 'Consultá el medio de pago'}`;
  }
}

// ── Paso 2: PRODUCTO ELEGIDO → datos de pago + pide comprobante ─────────────
export function productStepTienda(
  cfg: TiendaConfig,
  productId: string,
): { messages: BotMsg[]; buttons: Btn[]; data: Record<string, unknown>; step: string } {
  const p = findProduct(cfg, productId);
  if (!p || !p.active) {
    return {
      messages: [{ from: 'bot', delayMs: 500, at: now(), text: 'Ese producto ya no está disponible 🙈 Elegí otro de la lista.' }],
      buttons: productButtons(cfg),
      data: {},
      step: 'welcome',
    };
  }

  const price = formatPrice(p.price, p.currency || cfg.currency);
  const detail = [`🛒 *${p.name}* — ${price}`, p.description?.trim()].filter(Boolean).join('\n');

  const pays = enabledPayments(cfg);
  const messages: BotMsg[] = [
    { from: 'bot', delayMs: 600, at: now(), text: detail },
  ];
  if (pays.length) {
    const payText = ['Para confirmar tu compra, aboná con:', ...pays.map(paymentLine)].join('\n\n');
    // Si el único medio es transferencia con CBU, lo mandamos con botón copiar.
    const onlyTransfer = pays.length === 1 && pays[0].type === 'transfer' && pays[0].data;
    if (onlyTransfer) {
      messages.push({ from: 'bot', delayMs: 1000, at: now(), text: 'Para confirmar tu compra, transferí a:' });
      messages.push({ from: 'bot', delayMs: 1200, at: now(), text: String(pays[0].data), copy: String(pays[0].data) });
    } else {
      messages.push({ from: 'bot', delayMs: 1000, at: now(), text: payText });
    }
  }
  messages.push({ from: 'bot', delayMs: 1400, at: now(), text: '📸 Cuando pagues, mandame el comprobante por acá y te libero el producto 🙌' });

  return {
    messages,
    buttons: [],
    data: { productId: p.id, productName: p.name, price: p.price, currency: p.currency || cfg.currency },
    step: 'comprobante',
  };
}

// ── Comprobante recibido → revisión ─────────────────────────────────────────
export function onComprobanteTienda(): BotMsg[] {
  return [
    { from: 'bot', delayMs: 700, at: now(), text: '¡Recibí tu comprobante! 🧾' },
  ];
}

export function comprobanteReviewTienda(): BotMsg[] {
  return [
    { from: 'bot', delayMs: 700, at: now(), text: '✅ Estamos verificando tu pago 🔎 En breve te libero el producto.' },
  ];
}

export function comprobanteRejectedTienda(): BotMsg[] {
  return [
    { from: 'bot', delayMs: 500, at: now(), text: '⚠️ No pudimos validar el comprobante. Reenvialo por acá 📸 que se vea *completo y legible* (importe, fecha y destinatario).' },
  ];
}

// ── Entrega (al liberar el producto desde el panel) ─────────────────────────
export function deliveredMessagesTienda(
  cfg: TiendaConfig,
  data: Record<string, unknown>,
): BotMsg[] {
  const productId = typeof data.productId === 'string' ? data.productId : '';
  const p = productId ? findProduct(cfg, productId) : undefined;
  const name = p?.name ?? (typeof data.productName === 'string' ? data.productName : 'tu producto');

  const msgs: BotMsg[] = [
    { from: 'bot', delayMs: 600, at: now(), text: `🎉 *¡Pago confirmado!* Gracias por tu compra en *${cfg.brandName}* 🙌` },
  ];

  switch (cfg.delivery.mode) {
    case 'link': {
      const url = p?.deliveryUrl?.trim();
      msgs.push({
        from: 'bot', delayMs: 1000, at: now(),
        text: url ? `📚 Acá está *${name}*, entrá para descargarlo 👇\n${url}` : `📚 En un momento te enviamos el acceso a *${name}*.`,
      });
      break;
    }
    case 'email':
      msgs.push({ from: 'bot', delayMs: 1000, at: now(), text: `📧 Te enviamos *${name}* por email. Revisá tu casilla (y spam) 🙂` });
      break;
    case 'manual':
    default:
      msgs.push({ from: 'bot', delayMs: 1000, at: now(), text: `🙌 Un asesor te envía *${name}* en un momento.` });
      break;
  }
  if (cfg.delivery.note?.trim()) {
    msgs.push({ from: 'bot', delayMs: 1300, at: now(), text: cfg.delivery.note.trim() });
  }
  return msgs;
}

// ── Texto libre no reconocido ───────────────────────────────────────────────
export function onFreeTextTienda(step: string, cfg: TiendaConfig): BotMsg[] {
  if (step === 'validando') return [];
  if (step === 'welcome') {
    return [{ from: 'bot', delayMs: 700, at: now(), text: 'Elegí un producto de la lista para comprar 👇' }];
  }
  if (step === 'comprobante') {
    return [{ from: 'bot', delayMs: 700, at: now(), text: 'Cuando tengas el comprobante del pago, mandámelo por acá 📸' }];
  }
  if (cfg.supportUrl) {
    return [{ from: 'bot', delayMs: 600, at: now(), text: `🙋 Para ayudarte, escribinos por acá 👇\n${cfg.supportUrl}` }];
  }
  return [{ from: 'bot', delayMs: 600, at: now(), text: 'En un momento un asesor te ayuda 🙌' }];
}

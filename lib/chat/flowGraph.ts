// Constructor de flujo (nodos + conectores) para el chat. El cliente arma su guion
// como un grafo: nodos (mensaje / productos / botones / capturar / acción) unidos
// por conectores (`next` o botón→destino), con un fallback global ("respuesta ante
// algo distinto"). Si el flow está `enabled`, el runtime lo ejecuta nodo por nodo;
// si no, se cae al guion por defecto del nicho (nada se rompe).
//
// Vive en client_settings.chat_config bajo la clave `flow`. Es agnóstico de nicho,
// pero los nodos `products`/`payment` leen la matriz TiendaConfig para armar botones
// e instrucciones de pago (así el catálogo/precios siguen siendo data-driven).
import type { BotMsg, Btn } from '@/lib/chat/flow';
import {
  activeProducts,
  enabledPayments,
  findProduct,
  formatPrice,
  type TiendaConfig,
  type TiendaPaymentMethod,
} from '@/lib/chat/tienda';

export const BUY_PREFIX = 'buy:';

export type FlowNodeType = 'message' | 'products' | 'buttons' | 'capture' | 'action';
export type FlowActionKind = 'ask_receipt' | 'send_link' | 'support' | 'deliver';

export interface FlowButton {
  id: string;      // action id que manda el widget
  label: string;
  next?: string;   // nodo destino al tocar
}

export interface FlowNode {
  id: string;
  type: FlowNodeType;
  text?: string;               // mensaje (soporta {brand} {first_name} {name})
  buttons?: FlowButton[];      // type 'buttons'
  action?: FlowActionKind;     // type 'action'
  data?: string;               // dato auxiliar (ej. URL para send_link)
  captureKey?: string;         // type 'capture' → guarda el input en data[captureKey]
  next?: string;               // salida por defecto (message/products/capture/action)
  position?: { x: number; y: number };
}

export interface ChatFlow {
  enabled: boolean;
  startId: string;
  nodes: FlowNode[];
  fallback: string;            // respuesta global ante input no reconocido
  version: number;
}

export const EMPTY_FLOW: ChatFlow = { enabled: false, startId: '', nodes: [], fallback: '', version: 1 };

// ── Parser / validación ─────────────────────────────────────────────────────
const NODE_TYPES: FlowNodeType[] = ['message', 'products', 'buttons', 'capture', 'action'];
const ACTION_KINDS: FlowActionKind[] = ['ask_receipt', 'send_link', 'support', 'deliver'];

function s(v: unknown, fb = ''): string {
  return typeof v === 'string' ? v : fb;
}
function numOr(v: unknown, fb: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fb;
}

function parseButton(raw: unknown, i: number): FlowButton | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const label = s(o.label).trim();
  if (!label) return null;
  return { id: s(o.id).trim() || `opt${i + 1}`, label, next: s(o.next).trim() || undefined };
}

function parseNode(raw: unknown, i: number): FlowNode | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const id = s(o.id).trim() || `n${i + 1}`;
  const type = NODE_TYPES.includes(o.type as FlowNodeType) ? (o.type as FlowNodeType) : 'message';
  const buttons = Array.isArray(o.buttons)
    ? o.buttons.map(parseButton).filter((b): b is FlowButton => !!b)
    : undefined;
  const pos = o.position && typeof o.position === 'object' && !Array.isArray(o.position)
    ? o.position as Record<string, unknown>
    : undefined;
  return {
    id,
    type,
    text: s(o.text).trim() || undefined,
    buttons: buttons && buttons.length ? buttons : undefined,
    action: ACTION_KINDS.includes(o.action as FlowActionKind) ? (o.action as FlowActionKind) : undefined,
    data: s(o.data).trim() || undefined,
    captureKey: s(o.captureKey).trim() || undefined,
    next: s(o.next).trim() || undefined,
    position: pos ? { x: numOr(pos.x, 0), y: numOr(pos.y, 0) } : undefined,
  };
}

// Lee chat_config.flow (o el objeto crudo del flow).
export function parseChatFlow(raw: unknown): ChatFlow {
  const root = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const o = (root.flow && typeof root.flow === 'object' && !Array.isArray(root.flow)
    ? (root.flow as Record<string, unknown>)
    : root) as Record<string, unknown>;
  const nodes = Array.isArray(o.nodes)
    ? o.nodes.map(parseNode).filter((n): n is FlowNode => !!n)
    : [];
  const ids = new Set(nodes.map((n) => n.id));
  const startId = ids.has(s(o.startId)) ? s(o.startId) : (nodes[0]?.id ?? '');
  return {
    enabled: o.enabled === true && nodes.length > 0 && !!startId,
    startId,
    nodes,
    fallback: s(o.fallback).trim(),
    version: numOr(o.version, 1),
  };
}

export function findNode(flow: ChatFlow, id: string | null | undefined): FlowNode | undefined {
  if (!id) return undefined;
  return flow.nodes.find((n) => n.id === id);
}

// ── Interpolación de variables ──────────────────────────────────────────────
function firstName(name?: string | null): string {
  const n = (name ?? '').trim().split(/\s+/)[0];
  return n && /[a-zA-ZÀ-ÿ]/.test(n) ? n : '';
}

export interface FlowCtx {
  cfg: TiendaConfig;
  name?: string | null;
  data: Record<string, unknown>;
}

function interpolate(text: string, ctx: FlowCtx): string {
  const fn = firstName(ctx.name);
  const map: Record<string, string> = {
    brand: ctx.cfg.brandName,
    name: (ctx.name ?? '').trim(),
    first_name: fn,
  };
  return text.replace(/\{(\w+)\}/g, (_, k: string) => map[k] ?? `{${k}}`);
}

function paymentLine(pm: TiendaPaymentMethod): string {
  const data = pm.data?.trim();
  switch (pm.type) {
    case 'transfer':
      return data ? `🏦 *Transferencia*\nCBU/Alias: *${data}*` : '🏦 *Transferencia* (te pasamos los datos)';
    case 'payment_link':
      return data ? `💳 *Link de pago*\nPagá acá 👇\n${data}` : '💳 *Link de pago* (te lo enviamos)';
    default:
      return data ? `💠 ${pm.label ?? 'Otro medio'}: ${data}` : `💠 ${pm.label ?? 'Consultá el medio de pago'}`;
  }
}

// ── Intérprete ──────────────────────────────────────────────────────────────
export interface FlowRun {
  messages: BotMsg[];
  buttons: Btn[];
  nodeId: string | null;   // nodo donde quedamos esperando input (o null = fin)
  step?: string;           // override de chatSessions.step (ej. 'comprobante')
  data: Record<string, unknown>;
}

const MAX_STEPS = 60;
const now = () => Date.now();

// Ejecuta el flow desde `startNodeId` acumulando mensajes hasta un nodo que espera
// input (products/buttons/capture/ask_receipt) o el fin (sin next).
export function runFlow(flow: ChatFlow, startNodeId: string | null | undefined, ctx: FlowCtx): FlowRun {
  const messages: BotMsg[] = [];
  const data = { ...ctx.data };
  let cur = findNode(flow, startNodeId ?? flow.startId);
  let guard = 0;

  const emit = (text?: string) => {
    if (text && text.trim()) messages.push({ from: 'bot', delayMs: 600, at: now(), text: interpolate(text, { ...ctx, data }) });
  };

  while (cur && guard++ < MAX_STEPS) {
    const node: FlowNode = cur;
    switch (node.type) {
      case 'message': {
        emit(node.text);
        cur = findNode(flow, node.next);
        if (!node.next) return { messages, buttons: [], nodeId: null, data };
        continue;
      }
      case 'products': {
        emit(node.text);
        const btns: Btn[] = activeProducts(ctx.cfg).map((p) => ({
          id: `${BUY_PREFIX}${p.id}`,
          label: `${p.name} — ${formatPrice(p.price, p.currency || ctx.cfg.currency)}`,
        }));
        return { messages, buttons: btns, nodeId: node.id, data };
      }
      case 'buttons': {
        emit(node.text);
        const btns: Btn[] = (node.buttons ?? []).map((b) => ({ id: b.id, label: b.label }));
        return { messages, buttons: btns, nodeId: node.id, data };
      }
      case 'capture': {
        emit(node.text);
        return { messages, buttons: [], nodeId: node.id, data };
      }
      case 'action': {
        if (node.action === 'send_link') {
          const url = node.data?.trim();
          emit(node.text || (url ? `👉 ${url}` : ''));
          if (url && node.text) messages.push({ from: 'bot', delayMs: 900, at: now(), text: url });
          cur = findNode(flow, node.next);
          if (!node.next) return { messages, buttons: [], nodeId: null, data };
          continue;
        }
        if (node.action === 'support') {
          const url = node.data?.trim() || ctx.cfg.supportUrl;
          emit(node.text || '🙋 Escribinos por acá 👇');
          if (url) messages.push({ from: 'bot', delayMs: 900, at: now(), text: url });
          cur = findNode(flow, node.next);
          if (!node.next) return { messages, buttons: [], nodeId: null, data };
          continue;
        }
        if (node.action === 'ask_receipt') {
          // Muestra medios de pago (de la matriz) y pide el comprobante → 'comprobante'.
          const pays = enabledPayments(ctx.cfg);
          if (node.text) emit(node.text);
          if (pays.length) {
            const txt = ['Para confirmar, aboná con:', ...pays.map(paymentLine)].join('\n\n');
            messages.push({ from: 'bot', delayMs: 1000, at: now(), text: txt });
          }
          messages.push({ from: 'bot', delayMs: 1300, at: now(), text: '📸 Cuando pagues, mandame el comprobante por acá 🙌' });
          return { messages, buttons: [], nodeId: node.id, step: 'comprobante', data };
        }
        // 'deliver' es acción de panel (no runtime autom.): lo tratamos como fin.
        emit(node.text);
        return { messages, buttons: [], nodeId: null, data };
      }
      default:
        return { messages, buttons: [], nodeId: null, data };
    }
  }
  return { messages, buttons: [], nodeId: (cur?.id ?? null), data };
}

// Botones del nodo donde quedó esperando (para reanudar sin re-emitir mensajes).
export function flowButtons(flow: ChatFlow, nodeId: string | null | undefined, cfg: TiendaConfig): Btn[] {
  const node = findNode(flow, nodeId);
  if (!node) return [];
  if (node.type === 'products') {
    return activeProducts(cfg).map((p) => ({ id: `${BUY_PREFIX}${p.id}`, label: `${p.name} — ${formatPrice(p.price, p.currency || cfg.currency)}` }));
  }
  if (node.type === 'buttons') return (node.buttons ?? []).map((b) => ({ id: b.id, label: b.label }));
  return [];
}

// Avanza desde un nodo por el destino de un botón (o el `next` por defecto).
export function advanceByButton(flow: ChatFlow, fromNodeId: string, actionId: string, ctx: FlowCtx): FlowRun | null {
  const node = findNode(flow, fromNodeId);
  if (!node) return null;
  // products: cualquier buy:<id> avanza por node.next (el producto queda en data).
  if (node.type === 'products' && actionId.startsWith(BUY_PREFIX)) {
    const pid = actionId.slice(BUY_PREFIX.length);
    const p = findProduct(ctx.cfg, pid);
    if (!p || !p.active) return runFlow(flow, node.id, ctx); // reintenta mostrar productos
    const data = { ...ctx.data, productId: p.id, productName: p.name, price: p.price, currency: p.currency || ctx.cfg.currency };
    return runFlow(flow, node.next, { ...ctx, data });
  }
  if (node.type === 'buttons') {
    const btn = (node.buttons ?? []).find((b) => b.id === actionId);
    if (!btn) return null;
    return runFlow(flow, btn.next, ctx);
  }
  return null;
}

// Avanza desde un nodo 'capture' con el texto libre del cliente.
export function advanceByText(flow: ChatFlow, fromNodeId: string, text: string, ctx: FlowCtx): FlowRun | null {
  const node = findNode(flow, fromNodeId);
  if (!node || node.type !== 'capture') return null;
  const data = { ...ctx.data };
  if (node.captureKey) data[node.captureKey] = text;
  return runFlow(flow, node.next, { ...ctx, data });
}

// ── Seed: flow por defecto equivalente al guion hardcodeado de Tienda ─────────
export function seedTiendaFlow(): ChatFlow {
  return {
    enabled: false,
    startId: 'welcome',
    version: 1,
    fallback: 'Elegí un producto de la lista para comprar 👇',
    nodes: [
      { id: 'welcome', type: 'message', text: '¡Hola {first_name}! 👋 Bienvenido a *{brand}* 🛍️', next: 'productos', position: { x: 0, y: 0 } },
      { id: 'productos', type: 'products', text: 'Mirá lo que tenemos y elegí para comprar 👇', next: 'pago', position: { x: 0, y: 160 } },
      { id: 'pago', type: 'action', action: 'ask_receipt', position: { x: 0, y: 320 } },
    ],
  };
}

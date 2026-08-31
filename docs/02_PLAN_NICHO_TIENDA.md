# Nicho Tienda — esquema ideal (ecommerce, ej. CasaUrbana / ebooks)

> Rama: `feat/tob/nichos` · aditivo + feature-gate por `tenants.niche`. **No** altera Circo.
> Fuente de verdad de este nicho. Coordinación R1 con Claude TOB para piezas de front.

## 1. Concepto

Segundo gran nicho junto a **Circo** (casino, todo lo existente). **Tienda** = ecommerce
donde se vende un producto digital (ebooks). Reusa la infraestructura de chat web,
comprobante y confirmación por operario, pero adapta guion, botones, eventos y alta.

Embudo: **Pauta → Conversación → Venta → Soporte**.

## 2. Decisiones fijadas (2026-08-31, con el owner)

| Tema | Circo (hoy) | Tienda |
|------|-------------|--------|
| Canal | Chat web nuestro | **Chat web nuestro** (mismo widget, guion adaptado). Recibe comprobante en el chat. |
| Alta | Kommo **obligatorio** | Kommo **opcional** (soportar ambos; arrancar sin Kommo, CRM/panel nuestro) |
| Cuenta portal | Crea usuario (Pagoda/Partner/King) | **No hay** creación de cuenta portal |
| Paso pago | CBU → comprobante → acreditar ficha | Producto/compra → (datos de pago) → comprobante → **liberar producto** |
| Palabra | "carga" | **"compra"** |
| Liberador | Acreditar ficha + link "jugar" | **Liberar producto**: entregar ebook + disparar conversión |
| Evento venta | `CargoCRM<suffix>` (CAPI) | **`Purchase`** estándar de Meta (`value`+`currency`), disparado **manual** desde panel |
| Evento conversación | `ConversacionCRM<suffix>` | `Contact` estándar (conversación iniciada) |
| Pixel | por tenant | por tenant (CasaUrbana `901614269074086`) |

## 3. Arquitectura (aditiva)

1. **`tenants.niche`** (`circo`|`tienda`, default `circo`) — ya creado. `ResolvedTenant.niche`.
2. **Vocabulario de eventos por nicho** (`lib/niche.ts` + `lib/meta.ts::fullEventName`):
   - circo → `ConversacionCRM<suffix>` / `CargoCRM<suffix>` (intacto).
   - tienda → `Contact` / `Purchase` (estándar Meta, sin sufijo CRM).
3. **Onboarding niche-aware** (`app/api/admin/onboard`): Kommo requerido solo si
   `niche=circo` (o si se aporta). Tienda exige pixel + CAPI + URL del sitio.
4. **Runtime/plantillas por nicho** (`lib/chat/templates.ts` + `runtime.ts`): set de
   plantillas Tienda con "compra", sin portal/ficha. Default por `niche`.
5. **Flujo Tienda** (`lib/chat/flows/tienda.ts`): guion propio despachado por
   `tenant.niche` desde `app/api/chat/[slug]/{start,action,message}`. Circo intacto.
6. **Liberar producto (panel)**: el `approve` del operario, para tienda, entrega el
   ebook (link/acceso) y dispara `Purchase` con `value` (monto cargado a mano).

## 3.bis Proceso de venta = DATA-DRIVEN (no hardcodeado)

Decisión (2026-08-31): el proceso de venta lo define el **cliente** en el onboarding,
en pestañas **Producto / Pago / Entrega**. El guion se arma desde esa config; ningún
cliente Tienda tiene lógica hardcodeada.

Modelo (`lib/chat/tienda.ts` → `TiendaConfig`, guardado en `client_settings.chat_config.tienda`):
- **products[]**: `{ id, name, price, currency, description?, deliveryUrl?, active }`.
- **payments[]**: métodos que el cliente HABILITA — `{ type: transfer|payment_link|other, enabled, label?, data? }` (`data` = CBU/alias o URL de checkout).
- **delivery**: `{ mode: link|email|manual, note? }` — el cliente confirma cómo entrega el ebook.
- **brandName, currency, supportUrl**.

`parseTiendaConfig()` valida con defaults seguros (sin productos = onboarding incompleto).

## 4. Fases

- **T1** Vocabulario de eventos por nicho (backend). ← bajo riesgo
- **T2** Onboarding Kommo-opcional (backend).
- **T3** Runtime/plantillas Tienda + flujo Tienda + despacho por nicho (backend).
- **T4** Liberar producto en panel + `Purchase` manual con valor (backend + R1 front).
- **T5** Onboarding self-serve (front, Claude): el cliente completa su proceso de
  venta y **acepta URL + eventos del pixel**.
- **T6** Alta del cliente de prueba CasaUrbana + smoke.

## 5. Reparto (PTM)

- **Cursor TOB** (backend): nicho, eventos, onboarding backend, flujo/runtime Tienda,
  liberar producto (emisión `Purchase`), alta/smoke.
- **Claude TOB** (front): UI del onboarding self-serve, relabel del panel
  ("Liberar producto" en vez de "Acreditar"), copy del widget para Tienda.
- **R1** antes de tocar `flow.ts`, panel chats, widget.

## 6. Datos del cliente de prueba (CasaUrbana)

- Pixel: `901614269074086` · CAPI token: provisto (cargar en `.env`/alta, nunca en git).
- Objetivo Meta: ventas → maximizar conversaciones WhatsApp (primeras 100 del pixel) →
  luego maximizar conversión. Trackeo sobre sitio web + conversión personalizada.

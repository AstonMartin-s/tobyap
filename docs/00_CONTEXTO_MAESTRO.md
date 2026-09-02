# TOBYAP — Contexto maestro (bitácora viva)

> Fuente de verdad operativa junto a `docs/00_PLAN_MEJORAS_2026-08-19.md`.
> No pegar secretos. Actualizar al cerrar cada fase / cada cambio de contrato.

**Prod:** Railway `tobyap-production.up.railway.app` · clientes activos (King + otros)
**Alcance:** tracking Meta + chat Adaptador B + panel ops. Operario humano siempre. No es GATE+CRM.

## Bitácora 2026-09-02 — Tienda: dominios trackerapp.site + constructor de flujo (backend)

- **Dominios casaurbana VERDES:** `go.trackerapp.site` (landing) y `chat.trackerapp.site` (widget) con cert **VÁLIDO** en Railway. La traba era ownership: faltaban los TXT `_railway-verify.go` / `_railway-verify.chat` en Hostinger (el CNAME solo no alcanza). Agregados → validó y emitió al instante. Config de casaurbana ya apunta ahí (`chat_config.landingDomain` + `chatDomain`).
- **Constructor de flujo (Fase 1, backend) — LISTO, tsc verde:**
  - `lib/chat/flowGraph.ts` (NUEVO): modelo `ChatFlow` (nodos `message`/`products`/`buttons`/`capture`/`action` + conectores `next`/botón→destino + `fallback` global), parser `parseChatFlow`, intérprete puro (`runFlow`, `advanceByButton`, `advanceByText`, `flowButtons`), interpolación `{brand}/{name}/{first_name}`, seed por defecto `seedTiendaFlow()`. Nodos `products`/`payment(ask_receipt)` leen la matriz TiendaConfig (catálogo/precios/medios de pago siguen data-driven).
  - Dispatch aditivo en `start`/`action`/`message`: si `chat_config.flow.enabled` (solo niche tienda), lo maneja el intérprete; si no, cae al guion por defecto del nicho. Nada rompe Circo ni Tienda sin flow.
  - `app/api/panel/flow/route.ts` (NUEVO): GET/PUT del guion (GET devuelve seed si no hay nada). Gate niche=tienda en PUT.
  - `lib/chat/loadTienda.ts`: + `loadChatFlow()`.
- **Pendiente (Fase 2, FRONT — R1 a Claude TOB):** editor visual React Flow (canvas nodos+conectores) en pestaña "Guion" del panel Tienda, consumiendo `/api/panel/flow`. Contrato del grafo ya congelado en `flowGraph.ts`.

## Instancias (PTM)

| Instancia | Carpeta | Rama | Responsabilidad | No pisar |
|-----------|---------|------|-----------------|----------|
| **Cursor TOBYAP** `[TOB]` (esta) | `~/Projects/TOBYAP/tobyap-cursor` | `feat/tob/*` | hardening, `emitCargo`, CI/smokes, índices, retención `lead_summary`, docs maestro, backend | front/panel/copy de Claude; **no abre otros repos** |
| **Claude TOBYAP** `[TOB]` | `~/Projects/TOBYAP/tobyap` | `main` | correcciones clientes, front/panel, copy, ajustes diarios | `lib/cargo/**`, CI, resolve auth |
| Consumidor resolve | — (otro programa) | — | llama `GET /api/v1/resolve` | esta instancia **no** trabaja esa carpeta ni ese repo |

**Esta instancia = solo `tobyap-cursor`.** CRM sirvió para orquestar el plan (Aston); no es workspace ni destino de R1 emitido desde acá. Si hay que avisar un cambio de contrato resolve, se lo pasa a Aston y Aston habla con CRM Main.

**Protocolo (MSG-TOB-20260819-2, confirmado):** worktree separado. Cursor nunca hace checkout en `tobyap/` (eso le cambia el árbol a Claude). Claude no `git add -A` sobre archivos de Cursor. Merge `feat/tob/*` → `main` es explícito + review. Un deploy por fase.

## Contrato aguas abajo

- **Resolve** (`GET /api/v1/resolve`): superficie que consume otro programa. Endurecer auth/tenant (`REQUIRE_RESOLVE_*`) = Aston avisa al consumidor **antes**. Esta instancia no edita ni abre ese repo.
- **Pagoda:** solo `create-portal-account`. No ampliar.
- **Kommo:** webhook + bots CARGO/CBU. `webhook_secret` es opt-in (Fase 2.3).

## Bitácora

### 2026-08-31 — Tienda T5+T6: guion del chat + liberar producto (rama `feat/tob/nichos`)

Guion propio del nicho **Tienda** (data-driven desde `chat_config.tienda`), despachado por `tenant.niche` sin tocar Circo:

- **`lib/chat/flows/tienda.ts`** (nuevo): `welcomeStepTienda` (bienvenida + botón por producto `buy:<id>`), `productStepTienda` (detalle + medios de pago → paso `comprobante`), `comprobanteReviewTienda`/`onFreeTextTienda`, `deliveredMessagesTienda` (entrega link/email/manual).
- **`lib/chat/loadTienda.ts`** (nuevo): loader de `TiendaConfig`.
- Despacho por nicho en rutas chat: `start` (bienvenida+botones), `action` (`buy:` / `finish_upload` / `support`), `message` (texto libre Tienda, sin "quiero mi cuenta"/Pagoda), `upload` (comprobante directo a `validando`, sin gate de app).
- **Panel `approve`** (`app/api/panel/chats/route.ts`): para `tienda` = "liberar producto" → entrega el ebook + dispara **Purchase** con el valor del producto (`data.price`), sin mensaje de "jugar" ni Kommo.
- **Validado E2E en local (test tenant `casaurbana`):** matriz Producto persiste (marca/producto $9.900/transferencia/entrega link); chat arma bienvenida con botón de producto; al comprar pide transferir a `casaurbana.mp` y pide comprobante. typecheck verde.

**Reportes niche-aware** (`app/reportes/page.tsx`): para `tienda` se ocultan Canales Meta/Influencers, InfluencerSpend y "Reportes diarios de ads"; KPIs/tabla renombran `Cargas→Ventas` y la tabla por campaña oculta la columna Canal. typecheck verde.

Pendiente (Claude, R1): widget post-menú fijo (aún botonera Circo) + botonera Chats operario ("Liberar producto" en vez de Acreditar/Cargar/Retirar).

### 2026-08-31 — Tienda (T1–T3 backend) + config data-driven (rama `feat/tob/nichos`)

- **Modelo fijado** (ver `docs/02_PLAN_NICHO_TIENDA.md`): Tienda usa el chat web propio (recibe comprobante), Kommo opcional, "carga"→"compra", sin cuenta portal/ficha, evento de venta = `Purchase` estándar disparado MANUAL desde panel ("liberar producto"), embudo Pauta→Conversación→Venta→Soporte. Proceso de venta **data-driven** (pestañas Producto/Pago/Entrega), no hardcodeado.
- **Backend hecho:**
  - `lib/niche.ts`: `NICHE_EVENTS` (vocabulario por nicho). `lib/meta.ts::fullEventName` niche-aware → circo `ConversacionCRM/CargoCRM<suffix>` (intacto) · tienda `Contact`/`Purchase` (estándar, sin sufijo).
  - `app/api/admin/onboard`: Kommo obligatorio solo en circo; tienda exige `metaPixelId`. Discovery Kommo solo si hay credenciales.
  - `lib/chat/tienda.ts`: `TiendaConfig` + `parseTiendaConfig` (products/payments/delivery) en `client_settings.chat_config.tienda`.
- `npm run typecheck` verde. Nada de Circo tocado; todo gated por `niche`.
- **Pendiente (backend, Cursor):** flujo `lib/chat/flows/tienda.ts` + despacho por nicho en rutas chat · "liberar producto" + `Purchase` con valor manual en panel.

#### Bloque R1 — MSG-TOB-20260831-1 (Cursor TOB → Claude TOB)
- **DE:** Cursor TOB · **A:** Claude TOB · **TIPO:** aviso de contrato + pedido de front
- **MODULO:** nicho Tienda — onboarding UI + panel
- **CONTEXTO:** rama `feat/tob/nichos`. Backend Tienda T1–T3 listo (nicho, eventos por nicho, onboarding Kommo-opcional, `TiendaConfig`). Falta la UI.
- **CONTRATO:** `client_settings.chat_config.tienda` = `TiendaConfig` (`lib/chat/tienda.ts`: products[], payments[], delivery, brandName, currency, supportUrl). Usar `parseTiendaConfig`.
- **ACCION:** Claude — cuando toque front: (1) pestañas de onboarding **Producto / Pago / Entrega** que editan `chat_config.tienda`; (2) en el panel de chats, para `tenant.niche='tienda'` relabelar "Acreditar" → **"Liberar producto"** y ocultar CBU/portal/ficha. Coordinar antes de tocar `flow.ts`/panel.
- **REFERENCIAS:** `docs/02_PLAN_NICHO_TIENDA.md`, `lib/chat/tienda.ts`, `lib/niche.ts`.

### 2026-08-28 — Nichos: categorización Circo / Tienda (fundación, rama `feat/tob/nichos`)

- **Objetivo:** habilitar la instalación del sistema en otros nichos (primero un ecommerce de ebooks) sin romper los clientes actuales. Paso 1 = **solo categorizar**, no implementar aún el flujo del nuevo nicho.
- **Diseño (aditivo, cero riesgo prod):**
  - Columna `tenants.niche` (text, default `'circo'`). Todos los clientes existentes quedan en **Circo** automáticamente.
  - Dos ramas: `circo` (casino/apuestas = todo lo trabajado hasta hoy) · `tienda` (ecommerce/ebooks, proceso de venta a definir).
  - Registro central `lib/niche.ts` (`NICHES`, `Niche`, `DEFAULT_NICHE`, `NICHE_META`, `isNiche`, `parseNiche`).
  - `ResolvedTenant.niche` + `CreateTenantInput.niche` (default `circo` vía `parseNiche`). `resolve()` lo mapea con fallback.
- **Archivos:** `lib/niche.ts` (nuevo), `db/schema.ts`, `lib/types.ts`, `lib/tenants.ts`. **No** se tocó `flow.ts` ni rutas de chat todavía (el despacho por nicho vendrá en la fase de implementación de Tienda).
- **Migración (pendiente deploy):** `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS niche text DEFAULT 'circo';` (mismo patrón que `chat_config`; **no** `drizzle-kit push`).
- `npm run typecheck` verde (el único error es `scripts/check-mayofa-events.ts`, script no rastreado preexistente, ajeno a este cambio).
- **Overlap:** `schema.ts`, `types.ts`, `tenants.ts` son compartidos → ver bloque R1 abajo. `flow.ts` NO tocado (aviso previo cuando llegue el despacho por nicho).

#### Bloque R1 — MSG-TOB-20260828-1 (Cursor TOBYAP → Claude TOBYAP)
- **DE:** Cursor TOBYAP `[TOB]` · **A:** Claude TOBYAP `[TOB]`
- **TIPO:** aviso de contrato/estructura (pre-merge)
- **MODULO:** tenants (nicho) — `db/schema.ts`, `lib/types.ts`, `lib/tenants.ts`, `lib/niche.ts`
- **REF-MENSAJE:** MSG-TOB-20260828-1
- **CONTEXTO:** nueva rama `feat/tob/nichos`. Se agrega categorización de clientes por nicho (`circo` default / `tienda`) para instalar el sistema en un ecommerce de ebooks. Cambio 100% aditivo; `flow.ts` y rutas de chat sin tocar.
- **CONTRATO:** `tenants.niche` (text default `'circo'`) · `ResolvedTenant.niche: Niche` · `CreateTenantInput.niche?: Niche` · helpers en `lib/niche.ts`. Deploy requiere `ALTER TABLE ... ADD COLUMN IF NOT EXISTS niche`.
- **ACCION:** Claude — `git pull` antes de tocar `schema.ts`/`types.ts`/`tenants.ts`; usar `parseNiche`/`NICHE_META` para cualquier UI de alta o panel que muestre/edite el nicho. Coordinar antes de bifurcar `flow.ts` por nicho.
- **REFERENCIAS:** `lib/niche.ts`, esta bitácora.

### 2026-08-19 — Arranque Cursor TOBYAP + Fase 1 `emitCargo`

- Handoff MSG-TOB-20260819-1. Plan aprobado: aditivo, flags, sin reescritura.
- Fase 0.1–0.3: header `docs/PLAN.md`, este archivo, `.env.example` (keys reales de runtime, sin valores).
- Fase 1: `lib/cargo/emit.ts` — una `CargoCRM` por lead (`event_id` `cargo-{leadId}` / alias `cargo-session-{sessionKey}`).
  - Callsites: webhook Kommo, `POST /api/conversion-event/[slug]`, `POST /api/convert`, panel `op: approve`.
  - Approve era el bug (no disparaba CAPI directo). Flag `EMIT_CARGO_FROM_PANEL` default ON; `=0` lo apaga.
  - Bot CARGO **no** mueve el lead a Cargo$ (el bot sigue a Clientes regulares). `skipKommoStatus` en webhook/bot/convert.
- Overlap Claude: `app/api/panel/chats/route.ts` — solo se agregó el call `emitCargo` en `approve`; no se tocó unread/block/archive.
- `npm run typecheck` verde.
- **Mezcla (MSG-TOB-20260819-2):** Claude pusheó `5a7f704` a `origin/main` con `git add -A` y se llevó Fase 1 (`lib/cargo/emit.ts` + webhook/convert/panel approve) junto con front/embudo. Prod sync. El bug de approve→CAPI quedó resuelto en main. Viola “un deploy por fase” en el historial, no en runtime.
- **No se tocó** `/api/v1/resolve`.

### 2026-08-19 — Protocolo de carpetas (respuesta MSG-TOB-20260819-2)

- **Confirmado.** Ramas distintas en la misma carpeta no bastan: un `checkout` mueve el working tree del otro.
- Worktree Cursor: `~/Projects/TOBYAP/tobyap-cursor` en `feat/tob/hardening` (parte de `origin/main` @ `5a7f704`). `.env` symlink al de `tobyap/` (no se copia ni se commitea).
- Claude sigue en `~/Projects/TOBYAP/tobyap` / `main`.
- Fase 1 ya está en `main`; no se reabre `feat/tob/emitCargo`. Siguiente trabajo Cursor = Fase 2 en `feat/tob/hardening` (o rama nueva `feat/tob/<fase>`).

### 2026-08-19 — Loop deploy Claude (MSG-TOB-20260819-2 cierre)

- Claude deploya con `railway up` desde `tobyap/` (working tree local). **Pull de `main` antes de cada deploy.**
- Push a `origin/main` también dispara auto-deploy en Railway (visto el 2026-08-19 con `5a102b5`).
- Cursor **avisa** cuando mergea `feat/tob/*` → `main` (Fase 2+).
- Overlap: si Claude toca `app/api/panel`, `lib/meta`, `lib/chat/release` o webhooks → R1 antes de mergear. Cursor toca webhooks/`upload`/`file`/`resolve` en esta rama: el merge avisado es el R1 inverso.

### 2026-08-19 — Merge + deploy Livechat + hardening opt-in (`5a102b5`)

- Traje `origin/main` de Claude (`c022208`: acreditación duplicada, bono 30%, install-prompt nativo) a `feat/tob/hardening`. Fast-forward, sin conflicto de lógica. Panel chats sigue con `acreditarChat` + `emitCargo`.
- Merge a `main` vía worktree `tobyap/` (Cursor no hace checkout de `main`). Push `origin/main` `c022208..5a102b5`.
- Railway auto-deployó el commit (`4dc5b57c`, SUCCESS). No hizo falta `railway up` aparte.
- Columna `client_settings.chat_config` (jsonb, default `{}`): **no** se usó `drizzle-kit push` (iba a pedir truncar `landings` por un unique constraint viejo). Solo `ALTER TABLE … ADD COLUMN IF NOT EXISTS`.
- Ventana ~22:31 UTC: `/l/king/go` 500 por columna faltante. Tras el ALTER, `/l/king` y `/l/king/go` 200. `/livechat` redirige a `/login` (esperable sin sesión; entrar como **cliente**, no admin).
- **Aviso Claude:** `git pull` en `tobyap/` antes del próximo `railway up`, para no pisar este deploy con un working tree viejo.

### 2026-08-19 — Livechat: nombre PWA (Marceneitor vs King)

- Cuenta tenant `name=Marceneitor`; piel guardada `brandName=King`. El HTML/manifiesto ya servían King.
- El ícono de inicio en el celu queda pegado al nombre de cuando se instaló (iOS no lo actualiza). Hay que borrar y volver a agregar.
- Patch: chat refresca piel vía `/brand`; SW no cachea HTML/manifiesto; nota en el panel Livechat.

### 2026-08-20 — Ajustes de chat (Fase 4 parcial): oferta + links + preview

- Panel `/livechat` → **Ajustes de chat** (4 pestañas): Identidad, Oferta, Links, Vista previa.
- `chat_config` ampliado (sin migración): `offerType` (bonus|fichas), `offerValue`, `minDeposit`,
  `portalUrl`, `supportUrl`. Sin guardar = defaults King (30%, $1000, greenbet, wa.link).
- `lib/chat/runtime.ts` + `loadRuntime.ts`: parse + textos de promo + `buildConversationPreview`.
- `flow.ts`: funciones aceptan `cfg?: ChatRuntimeConfig` con default `DEFAULT_RUNTIME` (aditivo).
  Rutas start/action/message/panel/chats + `release.ts` cargan runtime por tenant.
- Magic-link Pagoda al acreditar sigue dinámico; portal config es fallback.

### 2026-08-20 — Export CSV flexible (panel chats)

- Botón «Exportar» con modal: rango de fechas (createdAt), filtro opcional por estado.
- CSV: nombre, usuario, telefono (549… sin «+», columnas separadas), estado, campana,
  ccpp, creado, actualizado, kommo. Límite 10k filas. `export_done` legacy sigue.
- Helper `phoneForExport` en `lib/phone.ts`.

### 2026-08-20 — Multi-operario / escala (Fases A–C)

**Contexto:** preparar el alta de +2/3 clientes y uso desde 2/3 compus (cada cliente
con su operario; a lo sumo supervisor/owner abre el mismo para mirar/actuar).

**Fase A — Escrituras atómicas (correctness multi-operario).** Antes, todas las
escrituras de `chat_sessions` leían el array de mensajes / objeto data en JS y lo
reescribían entero → lost-update si dos escritores pegaban a la vez (operario +
supervisor, o cliente + scheduler de recordatorios). Se centralizó en
`lib/chat/mutations.ts` (`appendChatMessages`, `mergeChatData`) que concatena/mergea
a nivel Postgres (`||`, `jsonb_set`, `- key`) — mismo criterio que `acreditarChat`.
Refactor: `app/api/panel/chats` (custom/pending/reject/support/set_step/archive/
mark_unread/block/get), `app/api/chat/[slug]/message`, `.../upload`, `lib/chat/reminders`.

**Fase B — Smoke de concurrencia.** `scripts/smoke-concurrency.ts` (`npm run
smoke:concurrency`): crea 1 fila efímera, dispara 25 appends + 25 merges en paralelo,
verifica que no se pierde ninguno y la borra. Corre contra la DB configurada (.env
apunta a prod) → correr off-hours; impacto = una fila temporal.

**Fase C — Guardarraíles de escala (reglas, no romper):**
- **1 réplica fija en Railway.** `rateLimit` (`lib/rateLimit.ts`) y los schedulers
  (`instrumentation-node.ts`: reminders/autoclose/purge/retry) son in-process. Con
  2+ réplicas se DUPLICAN recordatorios/notificaciones y el rate limit se parte.
  Para escalar horizontal primero mover schedulers a advisory-lock de Postgres.
- **Pool DB `max: 8` por proceso** (`db/index.ts`). Más clientes/fuentes = más polls
  concurrentes (chat activo ~3.5s, panel 6-8s). Medir pico de conexiones vs límite del
  plan Postgres antes de sumar fuentes; subir `max` o poner PgBouncer si hace falta.
- **Cache de tenant TTL 60s local al proceso**: cambios de config tardan ≤60s en verse.
- **Sesión de panel stateless (cookie HMAC 8h)**: login multi-compu OK, sin límite.
- Pendiente Fase D (opcional): señal visual de qué chat tiene abierto cada operario.

### 2026-08-21 — Inbox (antes “Todos”): máx 50 en curso + exentos

- Pestaña **Inbox** (no archivados, orden por último mensaje / `updatedAt`).
- Auto-archivo: solo chats **en curso** más viejos cuando pasan de 50 (`BANDEJA_LIMIT`).
- **Exentos** (nunca auto-archivan): Cargo$ (`done`), No cargó (`no_cargo`), Revisar (`validando` o comprobante pendiente).
- Archivados solo en pestaña Archivadas; cliente que vuelve a escribir → `archived: false` (ya existía).

### 2026-08-20 — Bandeja Todos: máx 30 chats + auto-archivo (superseded por Inbox 50)

- Regla anterior: en "Todos" solo los 30 chats no archivados más recientes. El resto se archiva
  automáticamente (`lib/chat/bandeja.ts`, `trimBandeja` en GET panel/chats).
- Reapertura: ya existía — cliente escribe o manda comprobante → `archived: false`.
- Revisar / No leídos siguen mostrando archivados con comprobante pendiente o sin leer.

### 2026-08-20 — Burbujas cliente ilegibles en panel (tema claro)

- Síntoma: mensajes del lead (izquierda) con fondo negro y texto invisible en Light Mode.
- Causa: `--card-3` no existía en `globals.css`; fallback `#1b1f28` + `--text` oscuro en light.
- Fix: `--card-3` en dark (`#1b1f28`) y light (`#eceef6`); burbujas usan tokens sin fallback hardcodeado.

### 2026-08-20 — Anti-loop de auto-respuestas del bot

- Síntoma: el bot repetía "Cuando tengas el comprobante… mandámelo por acá" en cada texto del cliente (loop).
- Fix (`app/api/chat/[slug]/message/route.ts`): si el auto-mensaje a enviar es idéntico al último mensaje del bot, no se reenvía (se dice una vez y espera). No se tocó `flow.ts`.

### 2026-08-20 — Bug reingreso PWA Android: form no pasaba (chunks viejos)

- Síntoma: en Android, al reabrir la app instalada, el formulario se veía pero no avanzaba.
- Diagnóstico: server OK (`/start` 200), WA-check OK (onWhatsApp true para el número), sin errores de consola en desktop, sin 429. Causa: **PWA con HTML cacheado viejo** (SW v1 servía HTML con hashes de chunks que tras los deploys dan 404) → React no hidrata → el form (SSR) se ve pero los botones no responden.
- Fix SW (`public/chat-sw.js` v3): navegación = network-first (online siempre HTML fresco; cache solo fallback offline). Purga caches viejos en activate. Manifest/brand siempre red.
- Fix cliente (`app/chat/[slug]/page.tsx`): salvavidas ante ChunkLoadError/unhandledrejection → desregistra SW, limpia caches y recarga una vez (guard en sessionStorage para no loopear).
- Nota seguridad: se auditaron env de Railway (secretos) solo lectura; NO se copian a git/chat.

### 2026-08-19 — Imagen de ejemplo del portal (king-portal-ref.png) faltante

- El "comprobante" roto en el panel era el `alt` de `PORTAL_REF_IMG = /king-portal-ref.png` (imagen de referencia del portal que el bot manda en Cargar/Retirar/Soporte). El archivo **no existe** en `public/` → 404 en prod.
- Cliente: no lo ve roto (el widget tiene `onError` que oculta la imagen). Panel: sí mostraba ícono roto.
- Fix panel (`ChatsClient.tsx`): imágenes del BOT con `onError` que las oculta (como el cliente); las del cliente (comprobantes reales) se siguen mostrando aunque fallen, para que el operador detecte problemas.
- Pendiente producto: subir la captura real a `public/king-portal-ref.png` para que el ejemplo se vea (no lo puedo fabricar; es screenshot real del portal).
- NOTA: TOBYAP no envía WhatsApp saliente. Las notificaciones del chat son push web de la PWA instalada; no se puede mandar a un número arbitrario.

### 2026-08-19 — Fix panel Chats: pestañas terminales vacías (King)

- Síntoma: en King, pestaña **Acreditados** mostraba "Sin chats" con contador 52. Idem **No cargó** (468).
- Causa: `GET /api/panel/chats` trae solo las 200 sesiones más recientes por `updatedAt`, pero los contadores salen de stats sobre TODA la base. Los acreditados/no_cargo de King son estados viejos (40/52 fuera de las 200) → la lista quedaba vacía. Además el filtro ocultaba archivados (17/52 done archivados).
- Fix backend: `GET ?view=done|no_cargo|archived` (límite 500) para pedir la pestaña terminal aparte. Archivadas filtra por `data->>'archived'`.
- Fix front (`ChatsClient.tsx`): las pestañas terminales usan esa lista dedicada y **no** ocultan archivados, así la lista coincide con el contador.
- Overlap con Claude (`ChatsClient.tsx`, `panel/chats`): fix de incidente en vivo; avisar a Claude para pull antes de tocar esos archivos.

### 2026-08-19 — Fase 2 hardening opt-in (luego en main `5a102b5`; flags siguen OFF)

- 2.4 `/api/test/capi` → 404 en production (`ALLOW_TEST_CAPI=1` emergencia).
- 2.5 `CRON_SECRET`: si está seteado sigue exigiendo header; prod sin secret = warning. Cierre: `REQUIRE_CRON_SECRET=1`.
- 2.3 `KOMMO_WEBHOOK_SECRET_<SLUG>` opt-in + `?secret=` (GET Kommo sigue abierto). Mismo gate en conversion-event.
- 2.6 HMAC en notas Kommo; sessionKey solo 14 días; panel autenticado siempre.
- 2.7 rate limit `track/redirect` (60/min IP) y `chat/start` (20/min IP). `RATE_LIMIT=0` apaga.
- 2.1/2.2 **no exigidos.** Warning en boot/logs. Si el caller manda `?client=` se filtra; si no, el comportamiento sigue igual. Flags `REQUIRE_RESOLVE_API_KEY` / `REQUIRE_RESOLVE_CLIENT` default 0. Prenderlos = Aston coordina con el consumidor; no se toca otro repo desde acá.

### 2026-08-19 — Fase 3 arranque: smoke de cableado (sin deploy)

- `scripts/smoke-wiring.ts` + `npm run smoke` (= typecheck + smoke:wiring). Lógica **pura**, no toca DB/prod/Meta.
- Cubre: `cargoEventId` (idempotencia lead/sesión), token HMAC del comprobante (firma/verifica/expira/legacy), rate limit (límite + kill switch).
- Resultado: **VERDE** (14/14). Es el gate local antes de cada paso. No requiere coordinar con Claude (archivos nuevos, sin overlap).

### 2026-08-19 — smoke:db (lectura, tenant no-King)

- `scripts/smoke-db.ts`: DB real + handler de resolve de ESTA rama. No escribe. No llama `emitCargo` (no pega Meta). No pega Railway.
- Tenant usado: `ClienteA1` (había cargas; se evitó King).
- Cargo: cero `event_id` duplicados; `eventExistsAny` ve uno sent y rechaza un lead inventado.
- Resolve (código nuevo, flags off): 401 sin key, 404 code inexistente, 200 con `?client=` correcto, 404 si el client no coincide, 200 sin `?client=` (compat).
- Resultado: **VERDE**. `npm run smoke` = typecheck + wiring + db.

### 2026-08-31 — Afiliados Telegram (Meta CAPI) + alta cliente SIN Kommo (`9024ba7`, `66926c0`)

- **Feature afiliados Telegram** (`9024ba7`, deploy SUCCESS):
  - Landing modo Telegram: `LandingConfig.telegramBot` + branch en `_landing.tsx` `go()` (`t.me/<bot>?start=<code>`, antes de redirectUrl/portalUrl/chatSlug/wa) + destino "Telegram" en `ConfigClient`.
  - `parseLeadId` (tolerante) en `lib/attribution.ts`.
  - Webhook `POST /api/webhooks/affiliate/[slug]`: HMAC-SHA256 sobre body crudo (`X-Signature`) → 401; match por `attributions.code`; `registro`→Conversacion, `carga`/`primera carga`→Cargo; dedup `conv-`/`cargo-<lead_id>` vía `eventExists`+`sendCapiEvent`. Cargas múltiples → mide la 1ª (resto `duplicate`). Sin match → `200 unmatched`.
  - Secreto cifrado (AES) `tenants.affiliate_webhook_secret` + migración aditiva (corrida en prod ANTES del deploy: `getTenantBySlug` hace `SELECT *`, la columna faltante rompería a TODOS) + config self-service en el panel (`/api/settings/affiliate-webhook`).
  - Contrato para el cliente: `docs/telegram-afiliados-contrato.md`.
- **Cliente candywin** (afiliados, SIN Kommo, `readonly`): onboardeado con pixel `1699551654171070` / suffix `A6` / secreto. Landing `telegram` (bot `candywinvip_bot`). Flags `feat_embudo/livechat/fichas=0` → panel solo Reportes + Config.
- **Test end-to-end OK:** `ConversacionCRMA6` + `CargoCRMA6` en Meta Test Events (`TEST86628`, seteado SOLO en proceso local, nunca en prod); dedup verificado; webhook deployado probado con code real → `duplicate`; smokes 401/400/unmatched.
- **Alta SIN Kommo** (`66926c0`, deploy SUCCESS): `/api/admin/deploy` modo `noKommo` (salta provision/discover/heal, exige Meta, `readonly`+flags, devuelve webhook de afiliados) + toggle "Sin Kommo" en `/admin/deploy`. **Estructura Kommo-opcional confirmada:** multi-tenant, un solo deploy; Kommo era obligatorio solo en el alta.
- **Overlap Claude (R1 MSG-TOB-20260831-1, ACKeado):** `_landing.tsx`, `ConfigClient.tsx` (feature) y `app/admin/deploy/*` (onboarding) tocados y en prod. Aditivo. Claude sincronizado desde `9024ba7`.
- **Auto-deploy**: se descongeló `watchPatterns` (estaba en `ops/__DEPLOY_FROZEN__/**` por el incidente Railway) → normal.

## Estado

| Fase | Estado |
|------|--------|
| 0 Documentación | en curso (0.1–0.3 hechos; 0.4 vive en el plan) |
| 1 `emitCargo` | **en main** (`5a7f704`, mezclado con panel). Pendiente smoke King / Events Manager |
| 2 Hardening | **en main/prod** (`5a102b5`). Flags default OFF. No prender `REQUIRE_RESOLVE_*` sin Aston. |
| 4 Livechat piel | **en main/prod**. Pestaña `/livechat` (nombre/color/foto). `flow.ts` intacto. Columna `chat_config` aplicada. |
| Afiliados Telegram | **en main/prod** (`9024ba7`). Webhook CAPI + landing Telegram + secreto cifrado. candywin activo y verificado (Test Events). Falta solo el POST del lado del cliente. |
| Alta sin Kommo | **en main/prod** (`66926c0`). Toggle "Sin Kommo" en `/admin/deploy` → cliente afiliados self-service. |

## Próximo paso

1. Claude: `git pull` en `tobyap/` antes del próximo `railway up`.
2. Antes de prender `REQUIRE_RESOLVE_API_KEY` / `REQUIRE_RESOLVE_CLIENT`: Aston avisa al consumidor de resolve (esta instancia no emite R1 ni abre ese repo).
3. King: opcional `KOMMO_WEBHOOK_SECRET_KING` + `?secret=` en Kommo (webhook + bot CARGO).
4. Fase 4 restante: copy/URLs del bot siguen en `flow.ts` (esto fue solo piel).

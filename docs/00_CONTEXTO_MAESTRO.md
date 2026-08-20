# TOBYAP — Contexto maestro (bitácora viva)

> Fuente de verdad operativa junto a `docs/00_PLAN_MEJORAS_2026-08-19.md`.
> No pegar secretos. Actualizar al cerrar cada fase / cada cambio de contrato.

**Prod:** Railway `tobyap-production.up.railway.app` · clientes activos (King + otros)
**Alcance:** tracking Meta + chat Adaptador B + panel ops. Operario humano siempre. No es GATE+CRM.

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

## Estado

| Fase | Estado |
|------|--------|
| 0 Documentación | en curso (0.1–0.3 hechos; 0.4 vive en el plan) |
| 1 `emitCargo` | **en main** (`5a7f704`, mezclado con panel). Pendiente smoke King / Events Manager |
| 2 Hardening | **en main/prod** (`5a102b5`). Flags default OFF. No prender `REQUIRE_RESOLVE_*` sin Aston. |
| 4 Livechat piel | **en main/prod**. Pestaña `/livechat` (nombre/color/foto). `flow.ts` intacto. Columna `chat_config` aplicada. |

## Próximo paso

1. Claude: `git pull` en `tobyap/` antes del próximo `railway up`.
2. Antes de prender `REQUIRE_RESOLVE_API_KEY` / `REQUIRE_RESOLVE_CLIENT`: Aston avisa al consumidor de resolve (esta instancia no emite R1 ni abre ese repo).
3. King: opcional `KOMMO_WEBHOOK_SECRET_KING` + `?secret=` en Kommo (webhook + bot CARGO).
4. Fase 4 restante: copy/URLs del bot siguen en `flow.ts` (esto fue solo piel).

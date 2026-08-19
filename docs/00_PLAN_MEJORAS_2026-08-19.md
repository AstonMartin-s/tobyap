# TOBYAP — Plan de mejoras (sin romper prod)

> **Estado:** aprobado 2026-08-19 · **Prod:** Railway `tobyap-production.up.railway.app` · clientes activos (King + otros)
> **Regla de oro:** ningún cambio altera flujos visibles al lead/operador sin smoke + deploy controlado.
> **Alcance excluido:** automatización de dinero (GATE/PAM). Siempre operario humano. TOBYAP = parche Kommo + empleados + Meta CAPI.

---

## División de instancias (PTM)

| Instancia | Carpeta | Rama | Tag | Responsabilidad |
|-----------|---------|------|-----|-----------------|
| **Cursor TOBYAP** | `~/Projects/TOBYAP/tobyap-cursor` (worktree) | `feat/tob/*` | `[TOB]` | Auditoría, hardening, `emitCargo`, CI/smokes, índices, retención, docs maestro, backend |
| **Claude TOBYAP** | `~/Projects/TOBYAP/tobyap` | `main` | `[TOB]` | Correcciones de clientes, front/panel, copy, ajustes diarios, temas “blandos” |
| Consumidor resolve | otro programa (orquesta Aston) | — | — | Llama `/api/v1/resolve`. **No es carpeta de Cursor TOBYAP.** |

**Protocolo (confirmado MSG-TOB-20260819-2):** no compartir working tree. Claude commitea en `main` de `tobyap`. Cursor commitea en `feat/tob/*` del worktree `tobyap-cursor`. Merge a `main` = paso explícito + review. Un deploy por fase. Nunca `git add -A` en la carpeta del otro.

---

## Principios de deploy (clientes en vivo)

1. **Cambios aditivos primero** — nueva función `emitCargo()` llama a la lógica vieja; no borrar paths hasta validar.
2. **Feature flags por env** — ej. `REQUIRE_WEBHOOK_SECRET=0` default; activar en prod cuando ops tenga secret en Kommo.
3. **Backward compatible** — webhooks sin secret siguen funcionando hasta fecha de corte anunciada.
4. **Smokes antes de merge** — `npm run typecheck` + scripts smoke (Fase 2).
5. **Un deploy por fase** — no mezclar hardening + emitCargo + CI en un solo push.
6. **Rollback** — Railway redeploy commit anterior; no migraciones destructivas.

---

## Fases

### Fase 0 — Documentación y arranque (0 riesgo prod)
**Duración:** 2–3 días · **Instancia:** Cursor TOBYAP

| # | Tarea | Entregable |
|---|-------|------------|
| 0.1 | Actualizar `docs/PLAN.md` header (Railway, chat, Cargo vía webhook/bot) | Doc |
| 0.2 | Crear `docs/00_CONTEXTO_MAESTRO.md` (bitácora viva) | Doc |
| 0.3 | Completar `.env.example` (RESOLVE_API_KEY, CRON_SECRET, WACHECK_*, UPLOAD_DIR, DISABLE_*) | Config |
| 0.4 | Documentar división Cursor vs Claude (este archivo § División) | Doc |
| 0.5 | Abrir instancia Cursor dedicada TOBYAP | Ops |

**Criterio de cierre:** nuevo dev puede onboard sin leer 15 docs obsoletos.

---

### Fase 1 — `emitCargo()` unificado (P0 producto)
**Duración:** 3–4 días · **Riesgo:** bajo si idempotente

**Objetivo:** una sola atribución `CargoCRM` por lead, sin importar origen.

**Fuentes actuales que deben converger:**
- Webhook Kommo → etapa Cargo$ (`releaseChatOnCargo` + CAPI)
- Bot `POST /api/conversion-event/[slug]`
- Panel `POST /api/convert`
- Panel chat `op: approve` (**hoy NO dispara CAPI** — bug)

**Diseño:**

```
lib/cargo/emit.ts
  emitCargo(tenant, { kommoLeadId?, sessionKey?, source, operator? })
    → event_id = cargo-{kommoLeadId} | cargo-session-{sessionKey}
    → si meta_events ya tiene success para ese event_id → return (idempotente)
    → sendCapiEvent(CargoCRM)
    → releaseChatOnCargo si aplica
    → updateLeadStatus Kommo Cargo$ (best-effort, no duplicar si ya está)
    → registrar en meta_events + log source
```

**Orden de implementación:**
1. Crear `emitCargo()` extrayendo lógica de `conversion-event` y webhook (sin cambiar behavior).
2. Reemplazar callsites uno por uno con tests manuales King.
3. Conectar `panel/chats approve` → `emitCargo(source:'panel')`.
4. Smoke: mismo leadId desde webhook + bot + panel → 1 solo evento Meta.

**Criterio de cierre:** Events Manager muestra 1 CargoCRM por lead aunque ops use panel y Kommo.

---

### Fase 2 — Hardening seguridad (P0)
**Duración:** 5–7 días · **Riesgo:** medio (requiere config ops)

| # | Cambio | Modo seguro |
|---|--------|-------------|
| 2.1 | `RESOLVE_API_KEY` obligatorio en prod (fail boot si falta) | Verificar CRM resolve antes |
| 2.2 | Resolve: exigir `?client=<slug>` en phone/code | Default backward: log warning 30 días |
| 2.3 | `webhook_secret` por tenant + query param Kommo | Opt-in por tenant; King primero |
| 2.4 | Deshabilitar `/api/test/capi` si `NODE_ENV=production` | — |
| 2.5 | `CRON_SECRET` obligatorio en `/api/cron/retry` | Railway cron con header |
| 2.6 | Comprobante `/file`: token HMAC corta vida | URLs viejas en Kommo siguen con sessionKey 14 días |
| 2.7 | Rate limit básico en `track/redirect` y `chat/start` | Por IP, soft 429 |

**Coordinación resolve:** Aston avisa al consumidor antes de 2.1 y 2.2. Cursor TOBYAP no trabaja ese repo.

---

### Fase 3 — CI mínimo + smokes (P1)
**Duración:** 3 días · **Sin movimiento de dinero**

> **Aclaración:** CI = checks automáticos al pushear (typecheck + scripts que simulan redirect/atribución/Cargo idempotente). **No** automatiza acreditación ni GATE. El operario sigue aprobando manualmente.

| Smoke | Qué valida |
|-------|------------|
| `smoke-typecheck` | `tsc --noEmit` |
| `smoke-resolve-auth` | 401 sin key, 200 con key |
| `smoke-resolve-tenant` | phone/code filtra por client |
| `smoke-emit-cargo-idempotent` | doble emitCargo → 1 meta_event |
| `smoke-attribution-pb` | redirect genera code PB |

Workflow `.github/workflows/ci.yml` en repo TOBYAP (si GitHub conectado) o script local `npm run smoke:gate`.

---

### Fase 4 — Multi-tenant config (P1) — explicación punto 6
**Duración:** 4–5 días · **Instancia:** Cursor backend; Claude puede ayudar en admin UI

**Problema:** King tiene URLs, copy y colores **hardcodeados** en `flow.ts` y `ChatWidget.tsx`. Otro cliente = editar código.

**Solución:** campo `tenants.chatConfig` (jsonb) o ampliar `client_settings`:

```json
{
  "brandName": "King",
  "portalUrl": "https://greenbet.uno/login",
  "supportUrl": "https://wa.link/...",
  "promoText": "20% en tu primera carga",
  "minDeposit": 1000,
  "postMenu": [...]
}
```

`flow.ts` lee config con fallback a valores actuales (King no cambia hasta migrar JSON).

**Claude:** pantalla admin para editar copy sin tocar código.

---

### Fase 5 — Datos: retención sin borrar clientes (P1) — punto 7
**Duración:** 3–4 días

**Regla:** nunca DELETE de identidad de cliente.

| Tabla | Política |
|-------|----------|
| `kommo_webhook_log` | Purga body > 30 días (solo log debug) |
| `chat_sessions.messages` | Archivar JSONB > 90 días a `chat_archive`; conservar fila mínima |
| `lead_summary` (nueva) | `phone`, `username`, `converted_once`, `tenant_id`, `first_seen`, `last_seen` — **nunca se borra** |
| Comprobantes disco | Borrar archivo > 180 días; mantener flag `had_comprobante` en summary |

**Migración:** backfill `lead_summary` desde `chat_sessions` existentes.

---

### Fase 6 — Ops: schedulers + índices (P2)
**Duración:** 2–3 días

- Railway: **1 réplica** documentada OR `DISABLE_*=1` + cron externo único
- Índices: `chat_sessions(tenant_id, session_key)`, `(tenant_id, kommo_lead_id)`, `meta_events(tenant_id, event_id)`, `attributions(code, tenant_id)`
- `instrumentation-node.ts`: log structured con `tenant.slug`

---

### Fase 7 — Chat transporte (P3, opcional)
SSE o reducir poll — solo si Fase 1–6 verdes. No urgente.

---

## Calendario sugerido

| Semana | Fase | Deploy prod |
|--------|------|-------------|
| S1 | 0 + 1 (emitCargo) | 1 deploy emitCargo |
| S2 | 2 (hardening parcial, secrets opt-in) | 1 deploy + config Kommo King |
| S3 | 2 (cerrar secrets) + 3 (CI) | 1 deploy |
| S4 | 4 (chatConfig) + 5 (retención) | 1 deploy |
| S5 | 6 (índices/schedulers) | 1 deploy |

---

## Checklist pre-deploy (cada fase)

- [ ] `npm run typecheck` verde
- [ ] Smokes de la fase verdes
- [ ] King chat `/chat/king` smoke manual (start → cuenta → CBU)
- [ ] Webhook Kommo test lead (staging o lead real mínimo)
- [ ] Events Manager: Conversacion + Cargo sin duplicar
- [ ] Rollback commit anotado

---

## Referencias

- Auditoría 2026-08-19 (Cursor CRM session)
- `lib/meta.ts` — idempotencia CAPI
- `app/api/conversion-event/[slug]/route.ts` — Cargo bot autoritativo hoy
- `app/api/webhooks/kommo/[slug]/route.ts` — Cargo por estado

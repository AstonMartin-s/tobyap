# TOBYAP — Plan de Seguridad, Dominios y Expansión (sin romper prod)

> **Estado:** propuesto 2026-08-27 · **Prod:** Railway `tobyap-production.up.railway.app` · clientes activos (King, bblack, paradise, CRM A1/A2, mooneyatkinson, otros)
> **Regla de oro:** ningún cambio altera flujos visibles al lead/operador sin smoke + deploy controlado. Todo aditivo, con feature flags y rollback.
> **Origen:** auditoría de seguridad de solo lectura 2026-08-27 (relevamiento completo de auth, rate limit, webhooks, headers, dominios).
> **Instancia:** Cursor TOBYAP `[TOB]` (Aston) — backend/seguridad/infra.

---

## 0. Diagnóstico (estado actual, resumido)

### Lo que ya está bien
- Login panel con **bcrypt** (cost 10) + cookie firmada **HMAC-SHA256** (`SESSION_SECRET`, 8h, httpOnly, secure en prod, sameSite lax).
- Secretos de tenant cifrados en DB con **AES-256-GCM** (`lib/crypto.ts`): tokens Kommo, Meta CAPI, OpenAI, Pagoda, partner.
- Queries con **Drizzle parametrizado** (sin inyección SQL evidente); `sql.raw` solo en scripts con constantes.
- **Rate limit** ya presente en `chat/start` (20/min/IP) y `track/redirect` (60/min/IP), con kill switch `RATE_LIMIT=0`.
- Split parcial de dominios: `go.fichaslibres.online` (landings) + `chat.fichaslibres.online` (`CHAT_ORIGIN`).
- Hardening de resolve/cron/webhooks **ya programado detrás de flags** (Fase 2 del plan 2026-08-19), pero **no activado**.

### Agujeros por severidad

| Sev | Riesgo | Evidencia |
|-----|--------|-----------|
| 🔴 Crítico | `/api/v1/resolve` **abierto sin API key** por default → expone tokens de atribución, fbc/fbp/fbclid, teléfonos | `app/api/v1/resolve/route.ts` L37–39 |
| 🔴 Crítico | Webhooks `/api/portal` y `/api/cbu` **sin auth** → crear cuentas Pagoda / escribir CBU en leads con solo saber el slug | `app/api/portal/[slug]/route.ts`, `app/api/cbu/[slug]/route.ts` |
| 🟠 Alto | `/api/cron/retry` **abierto** sin `CRON_SECRET` | `app/api/cron/retry/route.ts` L11–21 |
| 🟠 Alto | Webhooks Kommo abiertos por default (secret opt-in) | `lib/kommoWebhookAuth.ts` L24 |
| 🟠 Alto | **Sin headers de seguridad** globales (no middleware, no CSP/HSTS/X-Frame) | `next.config.js` L1–7 |
| 🟠 Alto | Chat API protegido **solo por `sessionKey`**, sin rate limit en message/upload/action | `app/api/chat/[slug]/message,upload,action` |
| 🟡 Medio | Comprobantes accesibles 14 días con solo `sessionKey` si falta `FILE_SIGNING_SECRET` | `lib/chat/fileToken.ts` |
| 🟡 Medio | **Login sin rate limit** → fuerza bruta contra bcrypt | `app/api/login/route.ts` |
| 🟡 Medio | Rate limit **in-memory** + IP de `X-Forwarded-For` → inútil con >1 réplica; IP spoofeable | `lib/rateLimit.ts` |
| 🟡 Medio | Webhook A3 POST sin validar firma `X-Hub-Signature-256` de Meta | `app/api/a3/webhook/[line]/route.ts` |
| ⚪ Bajo | Webhook amojo completamente abierto | `app/api/chat/amojo/[scope]/route.ts` |
| ⚪ Diseño | Sesiones legacy sin `panelRole` = acceso admin completo | `lib/session.ts` L85, L94 |

---

## ÁREA 1 — Hardening de seguridad (por fases)

### Fase S-A — "Cerrar puertas" (P0, rápido, bajo riesgo)
**Objetivo:** cerrar los agujeros críticos/altos que ya tienen flag o requieren poco código.

| # | Cambio | Modo seguro / rollback |
|---|--------|------------------------|
| SA.1 | `REQUIRE_RESOLVE_API_KEY=1` + setear `RESOLVE_API_KEY` | ⚠️ **R1 a CRM Main antes** (lo consume). Rollback: flag a 0 |
| SA.2 | `REQUIRE_CRON_SECRET=1` + `CRON_SECRET` en Railway cron | Rollback: flag a 0 |
| SA.3 | Extender `assertKommoWebhookSecret` a `/api/portal`, `/api/cbu`, `/api/retiro` (hoy sin auth) | Opt-in por tenant; sin secret sigue funcionando hasta corte anunciado |
| SA.4 | Validar firma `X-Hub-Signature-256` (Meta) en `/api/a3/webhook` POST | Solo si `A3_APP_SECRET` seteado |
| SA.5 | `KOMMO_WEBHOOK_SECRET_<slug>` por cliente activo (King → bblack → resto) | Opt-in; backward compatible |
| SA.6 | Rate limit en `/api/login` (anti fuerza bruta, soft 429 + backoff por IP) | Kill switch `RATE_LIMIT=0` |
| SA.7 | Rate limit en chat `message/upload/action` | idem |
| SA.8 | Confirmar `/api/test/capi` bloqueado en prod (salvo `ALLOW_TEST_CAPI=1`) | ya existe, verificar |

**Criterio de cierre:** resolve/cron/portal/cbu devuelven 401 sin credenciales; login resiste fuerza bruta.

### Fase S-B — Headers y CORS (P1)
| # | Cambio | Nota |
|---|--------|------|
| SB.1 | `middleware.ts` + `next.config` headers: HSTS, `X-Frame-Options: DENY` (panel), `X-Content-Type-Options: nosniff`, `Referrer-Policy` | Calibrar por ruta: el widget/PWA puede necesitar embebido |
| SB.2 | CSP calibrada para no romper widget, PWA ni pixel de Meta | Empezar en `Report-Only` y medir |
| SB.3 | Reemplazar `Access-Control-Allow-Origin: *` en `resolve`/`track` por whitelist de orígenes | Lista: dominios de landings + consumidor resolve |

### Fase S-C — Robustez a escala (P1/P2)
| # | Cambio | Nota |
|---|--------|------|
| SC.1 | Rate limit persistente (Redis/Upstash) reemplaza in-memory | Requisito para >1 réplica |
| SC.2 | IP real detrás de Railway/Cloudflare (no confiar ciego en XFF) | |
| SC.3 | WAF/proxy (Cloudflare) delante: DDoS, bot filtering, reglas por dominio | Ver Área 2 |
| SC.4 | Reducir acceso full de sesiones legacy sin `panelRole` | Forzar re-login o backfill de rol |

### Base de datos
| # | Cambio | Nota |
|---|--------|------|
| DB.1 | Backups automáticos + **prueba de restore** documentada | Railway PG backups |
| DB.2 | `sslmode=require` en `DATABASE_URL` | verificar |
| DB.3 | Usuario DB con permisos mínimos (no superuser en runtime) | evaluar |
| DB.4 | Retención de datos sensibles (ya en Fase 5 del plan viejo: `lead_summary`, nunca DELETE de `phone/username/converted_once`) | reusar |

---

## ÁREA 2 — Dominios: separar CRM de landings

### Recomendación
| Dominio | Rol | Protección |
|---------|-----|------------|
| **Dominio nuevo** (a comprar) ej. `app.<nuevo>.com` / `panel.<nuevo>.com` | **Solo panel / CRM / admin** | Superficie chica, WAF estricto, headers duros, sin CORS abierto |
| `go.fichaslibres.online` | Landings públicas de redirección | Cara "quemable" |
| `chat.fichaslibres.online` | Widget de chat (PWA) | Cara "quemable" |

**Por qué:** aislar la superficie de ataque. Si un dominio público se "quema" (reportes de Meta/WhatsApp, scraping, ataque), el CRM/admin y el resto de clientes quedan intactos. Reglas de firewall distintas por dominio.

### Matiz técnico a resolver
- Hoy **todo corre en un único servicio Railway**; separar dominios a nivel DNS aísla el *tráfico* pero no el *servidor*. Para aislamiento real evaluar (más adelante) separar deploy o al menos gating por host.
- La atribución `POST /api/track/redirect` es **same-origin** desde la landing. Si movemos el panel a un dominio nuevo y las landings quedan en `fichaslibres.online`, hay que:
  - Mantener el endpoint de tracking accesible desde el dominio de landings (mismo backend o CORS whitelist).
  - Ajustar `NEXT_PUBLIC_LANDING_ORIGIN`, `CHAT_ORIGIN`, `APP_PUBLIC_URL`, `RAILWAY_PUBLIC_DOMAIN`.
- **Costura cross-repo:** `/api/v1/resolve` lo consume CRM Main → cualquier cambio de host/CORS/auth **requiere R1**.

### Pasos
1. Comprar dominio (acción del usuario).
2. Cloudflare como DNS/proxy de ambos dominios (habilita WAF + rate limit de red).
3. Apuntar dominio nuevo → panel; mantener `go.`/`chat.` en fichaslibres.
4. Ajustar env vars de origins + CORS whitelist.
5. Smoke: login panel en dominio nuevo, landing→redirect→atribución PB OK, chat cross-origin OK.

---

## ÁREA 3 — Plan de protección + expansión (escalar clientes)

| # | Ítem | Detalle |
|---|------|---------|
| E.1 | **Onboarding estandarizado** | Cada cliente nuevo nace con secrets propios (webhook secret, API keys) y feature flags correctos. Extiende el alta global ya en curso |
| E.2 | **Aislamiento multi-tenant** | Auditar que todo query filtre por `tenantId`; operador de un cliente no ve datos de otro |
| E.3 | **Observabilidad** | Logging estructurado con `tenant.slug`; alertas (errores, picos, auth fallidos); Sentry o similar; dashboard salud (Railway metrics) |
| E.4 | **Escalado técnico** | Redis para rate limit + estado compartido → habilita >1 réplica. Hoy schedulers in-process + rate limit in-memory **no toleran multi-réplica** |
| E.5 | **Dominios rotables** | Pool de dominios de landing por si Meta/WhatsApp reporta uno; rotación por env sin redeploy |
| E.6 | **Runbook de incidentes** | Qué hacer ante: dominio quemado, DB caída, leak de secret, DDoS. Backups probados |
| E.7 | **Rotación de secretos** | Procedimiento para rotar `SESSION_SECRET`, `ENCRYPTION_KEY`, tokens de clientes sin downtime |

---

## Orden de ejecución sugerido (clientes en vivo)

| Paso | Fase | Deploy | Bloqueante |
|------|------|--------|------------|
| 1 | S-A (cerrar puertas, salvo resolve) | 1 deploy | — |
| 2 | S-A.1 resolve | 1 deploy | **R1 a CRM Main** |
| 3 | S-B (headers/CORS, CSP Report-Only primero) | 1 deploy | — |
| 4 | Área 2 (dominios) | config + 1 deploy | compra de dominio (usuario) |
| 5 | S-C + E.4 (Redis, observabilidad) | por partes | — |
| 6 | E.1–E.7 (expansión) | continuo | — |

---

## Checklist pre-deploy (cada fase)
- [ ] `npm run typecheck` verde
- [ ] Smoke manual del cliente afectado (King/bblack chat: start → cuenta → CBU)
- [ ] Webhook Kommo test lead con y sin secret (según fase)
- [ ] Events Manager: Conversacion + Cargo sin duplicar
- [ ] Rollback commit anotado
- [ ] R1 registrado si toca archivo compartido o costura cross-repo

---

## Referencias
- Auditoría de seguridad 2026-08-27 (solo lectura)
- Plan base: `docs/00_PLAN_MEJORAS_2026-08-19.md` (Fase 2 hardening)
- Bitácora: `docs/00_CONTEXTO_MAESTRO.md`
- Costura resolve: `app/api/v1/resolve/route.ts` + `docs/CONTRACT_MAP.md` (si existe) → CRM Main

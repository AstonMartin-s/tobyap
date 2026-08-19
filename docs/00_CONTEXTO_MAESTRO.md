# TOBYAP — Contexto maestro (bitácora viva)

> Fuente de verdad operativa junto a `docs/00_PLAN_MEJORAS_2026-08-19.md`.
> No pegar secretos. Actualizar al cerrar cada fase / cada cambio de contrato.

**Prod:** Railway `tobyap-production.up.railway.app` · clientes activos (King + otros)
**Alcance:** tracking Meta + chat Adaptador B + panel ops. Operario humano siempre. No es GATE+CRM.

## Instancias (PTM)

| Instancia | Responsabilidad | No pisar |
|-----------|-----------------|----------|
| **Cursor TOBYAP** `[TOB]` (esta) | hardening, `emitCargo`, CI/smokes, índices, retención `lead_summary`, docs maestro, backend | front/panel/copy de Claude |
| **Claude TOBYAP** `[TOB]` | correcciones clientes, front/panel, copy, ajustes diarios | `lib/cargo/**`, CI, resolve auth |
| **CRM Main** `[CRM]` | consume `GET /api/v1/resolve` | avisar R1 antes de cambiar auth/tenant |

**Rama:** `feat/tob/*` → review → merge `main` → deploy Railway manual. Un deploy por fase.
**WIP ajeno (2026-08-19):** Claude tiene cambios locales en chat/panel (`ChatsClient`, `Nav`, `embudo`, `purge`, `flow`, `panel/chats` GET unread/block). Cursor no revierte esos diffs.

## Contrato aguas abajo

- **CRM Main** → `GET /api/v1/resolve` (`RESOLVE_API_KEY`, filtro `?client=`). Fase 2.1/2.2 = R1 a CRM **antes** de endurecer.
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
- **No deploy todavía.** Falta smoke King + Events Manager (criterio de cierre Fase 1).
- **No se tocó** `/api/v1/resolve`.

## Estado

| Fase | Estado |
|------|--------|
| 0 Documentación | en curso (0.1–0.3 hechos; 0.4 vive en el plan) |
| 1 `emitCargo` | código listo, pendiente smoke King / deploy |
| 2 Hardening | no empezada |
| 3 CI/smokes | no empezada |

## Próximo paso

1. Smoke King: mismo `kommoLeadId` desde webhook + bot + panel approve → 1 fila `meta_events` status `sent` y 1 CargoCRM en Events Manager.
2. Commit aislado en `feat/tob/emit-cargo` (no incluir WIP de Claude).
3. Deploy Fase 1 único. Luego Fase 2 con R1 a CRM Main antes de 2.1/2.2.

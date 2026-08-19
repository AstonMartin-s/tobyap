# AGENTS.md — TOBYAP (TrackerIO)

> Multi-tenant Next.js + Postgres (Railway). Tracking Kommo → Meta CAPI + chat web + panel ops.

## Ciclo de trabajo (instancia Cursor TOBYAP)

```
main actualizado → rama feat/tob/<tarea> → typecheck (+ smoke cuando exista) → merge → deploy Railway controlado
```

Convención ramas Cursor: `feat/tob/emit-cargo`, `feat/tob/hardening-resolve`, etc.

## División con Claude TOBYAP

| Cursor TOBYAP | Claude TOBYAP |
|---------------|---------------|
| Backend, seguridad, CAPI, emitCargo, DB, CI | Front, copy, panel UX, fixes clientes del día |
| `lib/`, `app/api/`, `db/`, webhooks | `app/chats/`, `app/chat/`, `app/admin/`, estilos |

Coordinar por R1 (`MSG-TOB-*`) si ambos tocan el mismo archivo.

## Plan de mejoras

Fuente de verdad: **`docs/00_PLAN_MEJORAS_2026-08-19.md`**

Prod activo — **no reescribir**; fases aditivas con feature flags.

## Referencias cruzadas

- CRM Main consume `GET /api/v1/resolve` — avisar antes de cambiar auth o filtro tenant.
- Pagoda: `POST .../api/integrations/create-portal-account` (única integración activa).
- PTM global: `~/Desktop/Credenciales/docs/PTM.md`

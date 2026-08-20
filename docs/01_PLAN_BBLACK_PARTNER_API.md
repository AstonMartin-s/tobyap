# Plan de integración — Cliente **bblack** (Partner API v1.11)

Fecha: 2026-08-19
Estado: aprobado el enfoque **manual primero**; carga automática diferida.

---

## Contexto

- **King** usa **Pagoda** (`lib/pagoda.ts`): la plataforma *genera* el usuario y
  devuelve un magic-link. La carga de fichas la hace el operario **a mano**.
- **bblack** usa la **Partner API** (`api-lbvip.com/api/v1`, header `X-Api-Key`):
  server-to-server, mucho más potente. **Nosotros** generamos usuario/clave y,
  cuando querramos, podemos depositar/retirar/dar bonos por API.

**Aislamiento por key:** cada key opera solo sobre sus jugadores. Depósitos y
bonos salen del **saldo del agente dueño de la key** (por eso la carga automática
exige saldo cargado en esa cuenta — la diferimos).

---

## Alcance de esta etapa (MANUAL, igual a King)

Sí:
- Alta del tenant `bblack`.
- Crear jugador por API (`POST /players`) con user/pass generados por nosotros.
- Guardar credenciales en la sesión del chat + espejo en Kommo (igual que hoy).
- Botón "Jugar" → SSO por `POST /players/{user}/session` (opcional, sin plata).
- Carga de fichas: **manual** por el operario en la plataforma (como King).

No (fase siguiente, diferido):
- `POST /deposit` / `POST /withdraw` automáticos.
- Bono por API, netwin/GGR, retiros por API.

---

## Bloqueante

- **Faltan credenciales de bblack** (Base URL + `X-Api-Key`). Las genera el agente
  de bblack desde su panel (Clientes de API → Nuevo cliente) y se muestran una
  sola vez. **Pedírselas al cliente.** Sin esto no se prueba contra la API real,
  pero el código puede quedar listo.

---

## Arquitectura: abstracción de "provider"

Para sumar bblack sin tocar el flujo de King, ramificamos por **provider** del
tenant.

- Nuevo campo en `tenants`: `provider text default 'pagoda'`
  - `'pagoda'`  → King (comportamiento actual, intacto).
  - `'partner_api'` → bblack.
- Nuevo `lib/partner-api.ts` (server-to-server, con throttle 60 req/min).
- `accountStep()` y el botón "Jugar" ramifican por `tenant.provider`.

---

## Checklist de implementación (auditado, archivo por archivo)

### 1. Schema / tenant
- [ ] `db/schema.ts`: agregar `provider` + campos de la Partner API
      (`partnerApiUrl`, `partnerApiKey` cifrada). Reusar patrón de `pagodaUrl` /
      `pagodaApiKey` (líneas ~78-79).
- [ ] `lib/types.ts`: sumar `provider`, `partnerApiUrl`, `partnerApiKey` a
      `ResolvedTenant` y a `CreateTenantInput`.
- [ ] `lib/tenants.ts`: resolver los nuevos campos (descifrar la key).
- [ ] Migración: `ALTER TABLE tenants ADD COLUMN provider ... / partner_api_url ...`.

### 2. Capa Partner API — `lib/partner-api.ts` (NUEVO)
- [ ] `createPlayer(tenant, { username, password, phone?, email? })` → `POST /players`.
      Manejar `201` OK y `422` validación (username tomado → regenerar sufijo).
- [ ] `getPlayer(tenant, username)` → `GET /players/{user}` (saldo).
- [ ] `session(tenant, username)` → `POST /players/{user}/session` → `redirect_url`
      (SSO de 1 solo uso, 60s).
- [ ] `getConfig(tenant)` → `GET /config` (cachear: feats/límites).
- [ ] (Diferido, dejar firmados sin usar): `deposit`, `withdraw`, `bonus`, `stats`.
- [ ] Helper `buildPlayerUsername(name, phone)`: 3-18 chars, `[a-zA-Z0-9_]`, único.
      Reusar idea de `buildPortalName` de `lib/pagoda.ts` pero con reintento ante
      `422` (colisión de username) — nosotros elegimos el nombre, no la plataforma.
- [ ] Throttle propio (60 req/min) — mismo patrón que `lib/kommo-throttle.ts`.

### 3. Flujo de chat — ramificar por provider
- [ ] `lib/chat/flow.ts` → `accountStep()`: si `provider==='partner_api'`, generar
      user/pass, llamar `createPlayer`, devolver credenciales. Si `'pagoda'`, dejar
      exactamente el código actual.
- [ ] "Jugar" / login: con Partner API pedir `/session` **fresco** cada vez (no
      guardar el link, vence en 60s). Fallback: mostrar user/pass + página de login.
- [ ] Copys: idénticos a King salvo marca. La carga sigue siendo manual.

### 4. Alta del tenant bblack (config, sin código)
- [ ] Script `scripts/seed-tenant.ts` / `onboard-client.ts`: alta `bblack` con
      Kommo, Meta, landing, números, `provider='partner_api'`, credenciales cifradas.
- [ ] Landing + `ccpp`→bono (revisar `lib/attribution.ts` / `bonoMap`).

### 5. Verificación
- [ ] `tsc --noEmit` + `npm run build`.
- [ ] Con credenciales reales: crear un jugador de prueba, validar, pedir `/session`,
      confirmar SSO. Borrar el jugador de prueba.
- [ ] Regresión King: confirmar que `provider='pagoda'` no cambió en nada.

---

## Fase siguiente (diferida) — Carga automática

Cuando el cliente quiera y haya saldo del agente:
- Aprobar comprobante en el panel → `POST /deposit` con `reference` idempotente
  (guardada en DB) + bono según `ccpp`. Fichas al instante.
- Botón fallback manual por si falla la API o falta saldo.
- Retiros por API, bono suelto (reintegros/rachas), netwin para comisiones.

**Idempotencia:** `reference` única por operación, guardada en DB. Ante timeout,
reintentar con la MISMA reference (nunca generar otra). Mismo principio que el
candado `accreditedAt` que ya usamos en `lib/chat/release.ts`.

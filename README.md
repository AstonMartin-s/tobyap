# TOBYAP — Tracking Kommo → Meta CAPI (multi-tenant)

Sistema de tracking de conversiones: la landing capta la atribución del anuncio
(`fbclid`/`fbc`/`fbp`), Kommo la guarda en custom fields, y el backend reporta a
Meta Conversions API los eventos **ConversacionCRM** (inicia chat) y **CargoCRM**
(compra), con deduplicación por `event_id`.

**Stack:** Next.js 14 (App Router, TS) · Postgres (Drizzle) · **Railway** (app + DB).

## Documentación (`docs/`)

- [`docs/estructura-paybot.md`](docs/estructura-paybot.md) — mapa funcional/técnico completo del sistema PAYBOT (fuente de verdad).
- [`docs/PLAN.md`](docs/PLAN.md) — plan de arquitectura y modelo de datos.
- [`docs/PROMPTS.md`](docs/PROMPTS.md) — plan de desarrollo en fases (prompts para Cursor).
- [`docs/RESUMEN_Y_HANDOFF_CURSOR.md`](docs/RESUMEN_Y_HANDOFF_CURSOR.md) — resumen consolidado + handoff.

---

## Puesta en marcha

```bash
npm install
cp .env.example .env        # completar valores (ver abajo)
npm run db:push             # crea las tablas en Postgres
npm run dev                 # http://localhost:3000
```

### Variables de entorno (`.env`)

| Var | Qué es |
|-----|--------|
| `DATABASE_URL` | Postgres de Railway (privada en deploy, pública para `db:push` local). |
| `ENCRYPTION_KEY` | 32 bytes hex. Cifra tokens en DB. `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `ADMIN_TOKEN` | Protege el alta de tenants. |
| `SESSION_SECRET` | Firma la cookie de sesión del panel. |
| `META_TEST_EVENT_CODE` | (Opcional, dev) muestra eventos en "Eventos de prueba". |

---

## Alta de un cliente (tenant)

**Opción A — endpoint admin (recomendada, usa el server con env cargada):**
```bash
curl -X POST http://localhost:3000/api/admin/tenants \
  -H "x-admin-token: $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  --data @tenants/crmmattdamon.json
```

**Opción B — script de consola:**
```bash
npm run seed:tenant -- tenants/crmmattdamon.json
```

Los secretos van en el JSON **solo en local** (el código los cifra al insertar).
`tenants/*.json` está en `.gitignore` (excepto `example.json`). **Nunca** commitear tokens.

> El tenant de prueba `crmmattdamon` ya tiene la config (pipeline `14006947`,
> pixel `1699551654171070`, `event_suffix "30"`, custom fields). Faltan: pegar los
> tokens en local y crear en Kommo los custom fields `_fbc` / `_fbp` (agregar sus ids
> a `customFields.fbc` / `customFields.fbp`).

---

## Validar Meta CAPI

```bash
curl -X POST "http://localhost:3000/api/test/capi?tenant=crmmattdamon"
```
Debe responder `events_received: 1`. Verificalo en
Events Manager → dataset `1699551654171070` → Eventos de prueba.

---

## Webhook de Kommo

Apuntar los triggers de Kommo (Ajustes → Webhooks) a:
```
https://<tu-app>.up.railway.app/api/webhooks/kommo/<slug>
```
- **Lead agregado** → dispara `ConversacionCRM<suffix>` (`event_id = conv-<leadId>`).
- **Etapa del lead cambia** → si pasa a `status_cargo`, dispara `CargoCRM<suffix>`
  (`event_id = cargo-<leadId>`).

El `event_id` es determinístico → reintentos del webhook son **idempotentes**.

---

## Deploy en Railway

La app y la DB viven en Railway (Nixpacks detecta Next.js solo).

1. **Service nuevo** → "Deploy from GitHub repo" (o `railway up` con la CLI) apuntando a `tobyap/`.
2. **Variables** del service (Settings → Variables):
   - `DATABASE_URL` → la del Postgres de Railway. Dentro de Railway usá la **URL privada**
     (`postgres.railway.internal`); para `db:push` desde tu máquina usá la **pública**
     (`*.proxy.rlwy.net`).
   - `ENCRYPTION_KEY`, `SESSION_SECRET`, `ADMIN_TOKEN` (los mismos que en local).
   - `META_TEST_EVENT_CODE` (opcional).
3. **Build/Start**: por defecto Nixpacks corre `npm run build` y `npm run start`.
   Next escucha el `PORT` que inyecta Railway automáticamente.
4. **Migraciones**: corré `npm run db:push` (desde local contra la URL pública, o como
   comando one-off en Railway) cada vez que cambie el schema.
5. **Dominio**: Settings → Networking → "Generate Domain" → te da `…up.railway.app`.
   Esa es la base para el webhook de Kommo y el `trackApi` de las landings.

> Las **landings** (`templates/landing/`) son sitios estáticos: podés servirlas como
> un static service en Railway o cualquier host estático. Solo necesitan apuntar su
> `trackApi` a la URL de la app.

---

## Landing

Usar `landing-captura-atribucion.html` (en `~/Downloads`): capta `_fbc`/`_fbp`/`fbclid`
+ UTMs en hidden fields. Reemplazar `TU_PIXEL_ID` por `1699551654171070` y apuntar el
form al endpoint que crea el lead en Kommo.

---

## Estructura

```
app/
  api/admin/tenants/route.ts      # alta de tenants (PROMPT 2)
  api/test/capi/route.ts          # prueba CAPI (PROMPT 3)
  api/webhooks/kommo/[slug]/route.ts  # webhook (PROMPT 4)
  api/login | api/convert         # panel (PROMPT 5)
  login/ | convertidos/           # UI panel
db/schema.ts                      # tenants, leads, meta_events, kommo_webhook_log
lib/crypto.ts                     # AES-256-GCM
lib/tenants.ts                    # alta + resolución + cache
lib/meta.ts                       # cliente CAPI
lib/kommo.ts                      # cliente Kommo
lib/session.ts                    # cookie firmada
```

---

## Seguridad

- [ ] **Rotar** los access tokens que circularon (Kommo, Meta CAPI, pass CRM) antes de deploy.
- [ ] Cargar los tokens **nuevos** (se cifran solos al insertar). Nunca en el repo.
- [ ] `ENCRYPTION_KEY`, `SESSION_SECRET`, `ADMIN_TOKEN` solo en ENV de Vercel.
- [ ] Verificar dedup en Events Manager.

### Nota sobre `npm audit`
Avisos remanentes, evaluados y aceptados para el MVP:
- **esbuild (moderate)**: solo afecta el dev-server de drizzle-kit/tsx; no va a producción.
- **next / postcss (broad range)**: los vectores concretos (Image Optimizer `remotePatterns`,
  `rewrites`, caché de `next/image`, CSS stringify) **no se usan acá**. El fix es Next 16
  (cambio mayor); reevaluar al migrar.

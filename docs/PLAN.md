# TOBYAP — Plan de desarrollo (sistema propio de tracking)

> Objetivo del MVP: **trackear conversaciones y clientes convertidos desde Kommo y
> enviarlos a Meta (Pixel + Conversions API) con deduplicación por `event_id`.**
> Stack: **Next.js (App Router) + Vercel + Postgres**. Compra (`CargoCRM`) se marca **manual**.

---

## 1. Arquitectura del MVP

```
Kommo (webhooks)  ──▶  /api/webhooks/kommo  ──┐
                                              ├─▶  Cola/registro en Postgres (events)
Panel "Convertido" ─▶ /api/convert  ─────────┘            │
                                                          ▼
                                          Meta Conversions API (server)
                                                  +  Pixel (browser, opcional MVP)
                                          dedup por event_id  ◀── mismo id en ambos
```

**Eventos que mandamos a Meta:**
| Evento interno   | Disparador (Kommo)                                  | Meta event_name        |
|------------------|-----------------------------------------------------|------------------------|
| `ConversacionCRM`| Webhook "conversación agregada" / primer msg entrante | `Lead` (o custom)      |
| `CargoCRM`       | Botón **Convertido** en el panel (manual)           | `Purchase` (o custom)  |

> Nota: PAYBOT usa conversiones personalizadas (`ConversacionCRM2`, `CargoCRM2`).
> Podemos usar `event_name` estándar (`Lead`, `Purchase`) + un `custom_data` con el
> nombre interno, o conversiones personalizadas en Meta. Decidir al configurar el pixel.

---

## 1b. Multi-tenant (varios clientes)

El sistema gestiona **N clientes**. Cada cliente se da de alta con **9 campos** + config
de pipeline/eventos. Toda la data (leads, eventos) está particionada por `tenant_id`.

**Alta de un cliente (los 9 campos):**
1. SUBDOMAIN – Kommo   2. TOKEN – Kommo   3. EMAIL – Kommo   4. PASSWORD – Kommo
5. USUARIO PANEL   6. CONTRASEÑA PANEL   7. API KEY – OpenAI   8. PIXEL – Meta   9. TOKEN – Meta

**Config adicional por cliente:** `pipeline_id`, sufijo de eventos
(`ConversacionCRM<N>` / `CargoCRM<N>`), y mapa de custom fields.

```sql
table tenants (
  id              uuid pk,
  slug            text unique,        -- ej: "oneplay423" (usado en la URL del webhook)
  name            text,
  -- Kommo
  kommo_subdomain text,               -- oneplay423
  kommo_token     text,               -- token largo (cifrar en reposo)
  kommo_email     text,
  kommo_password  text,               -- cifrar
  kommo_pipeline_id bigint,
  -- Panel
  panel_user      text,
  panel_password_hash text,
  -- OpenAI
  openai_api_key  text,               -- cifrar
  -- Meta
  meta_pixel_id   text,               -- 821439413865998
  meta_capi_token text,               -- cifrar
  event_suffix    text,               -- "6"  -> ConversacionCRM6 / CargoCRM6
  -- mapeo flexible de custom fields de Kommo
  custom_fields   jsonb,              -- { "platform": 887302, "cbu": ..., "alias": ... }
  active          bool default true,
  created_at, updated_at
)
```

> El webhook de Kommo entra por `/api/webhooks/kommo/[slug]` → resuelve el `tenant`.
> Las credenciales sensibles se guardan **cifradas** (AES con `ENCRYPTION_KEY` de entorno).

---

## 2. Modelo de datos (Postgres)

```sql
-- Lead/contacto espejado de Kommo, con datos de atribución de Meta
table leads (
  tenant_id       uuid fk,           -- <<< partición por cliente
  id              uuid pk,
  kommo_lead_id   bigint unique,
  kommo_contact_id bigint,
  phone           text,
  name            text,
  campaign_id     text,        -- viene de la landing / URL
  fbp             text,        -- _fbp cookie
  fbc             text,        -- _fbc (fbclid)
  event_source_url text,
  pixel_id        text,
  status          text,        -- estado actual del pipeline
  created_at, updated_at
)

-- Cada evento enviado a Meta (idempotencia + auditoría)
table meta_events (
  id            uuid pk,
  lead_id       uuid fk,
  event_name    text,          -- ConversacionCRM | CargoCRM
  event_id      text unique,   -- dedup con el Pixel
  payload       jsonb,         -- lo que mandamos
  response      jsonb,         -- lo que respondió Meta
  status        text,          -- pending | sent | failed
  sent_at,      created_at
)

-- Log crudo de webhooks de Kommo (debug / reprocesar)
table kommo_webhook_log (id, body jsonb, received_at, processed bool)
```

---

## 3. Endpoints / rutas (Next.js App Router)

- `POST /api/webhooks/kommo` — recibe webhooks de Kommo. Valida, persiste en
  `kommo_webhook_log`, upsert de `leads`, y si corresponde encola `ConversacionCRM`.
- `POST /api/convert` — recibe `{kommo_lead_id, value?, currency?}` desde el panel,
  marca convertido y dispara `CargoCRM`. Protegido con token simple.
- `lib/meta.ts` — `sendCapiEvent({event_name, event_id, user_data, custom_data, event_source_url})`
  que pega a `graph.facebook.com/v21.0/{PIXEL_ID}/events?access_token=...`.
  Hashea (SHA-256) phone/email para `user_data`. Setea `action_source: "system_generated"` o `"website"`.
- `GET /convertidos` — página mínima (lista de leads + botón "Marcar convertido").
  Auth básica por password/token de entorno (sin user system todavía).

---

## 4. Detalle del envío a Meta CAPI

Payload mínimo por evento:
```json
{
  "data": [{
    "event_name": "Lead",
    "event_time": 1719250000,
    "event_id": "<uuid-dedup>",
    "action_source": "website",
    "event_source_url": "https://<landing>.vercel.app",
    "user_data": {
      "ph": ["<sha256(phone)>"],
      "fbp": "fb.2....",
      "fbc": "fb.1....",
      "client_ip_address": "...",
      "client_user_agent": "..."
    },
    "custom_data": { "internal_event": "ConversacionCRM", "campaign_id": "000" }
  }]
}
```
- **Deduplicación**: el `event_id` debe ser el MISMO que se usaría en el Pixel del
  browser, para que Meta no cuente doble. En el MVP (server-side puro) generamos un
  `event_id` estable por (lead + event_name).
- Usar **Test Event Code** durante desarrollo para ver los eventos en el Events Manager.

---

## 5. Configuración de webhooks en Kommo

En Kommo → Ajustes → Centro de integraciones → Webhooks, apuntar a
`https://<tu-app>.vercel.app/api/webhooks/kommo` con los triggers:
- Lead agregado
- Conversación agregada
- Mensaje entrante recibido
- El estado del lead cambia

(Estos ya están configurados en PAYBOT; replicamos los mismos.)

---

## 6. Variables de entorno (.env)

```
DATABASE_URL=postgres://...
KOMMO_SUBDOMAIN=paybotcrm13
KOMMO_LONG_LIVED_TOKEN=...      # token de larga duración del widget
KOMMO_PIPELINE_ID=13122207
META_PIXEL_ID=1131496748897137
META_CAPI_TOKEN=...             # token de Conversions API
META_TEST_EVENT_CODE=TEST...    # solo dev
CONVERT_PANEL_TOKEN=...         # auth simple del panel
```

---

## 7. Checklist de credenciales a conseguir (antes de codear)

- [ ] **Kommo – Token de larga duración**: Ajustes → Centro de integraciones →
      (tu integración PAYBOT) → Llaves y alcances → "Generar token de larga duración".
- [ ] **Kommo – ID de integración** y subdominio (`paybotcrm13.kommo.com`).
- [ ] **Kommo – IDs**: pipeline (13122207) y de los estados que importan
      (Leads Entrantes, Creo Usuario, Logrado). Ya los tengo del `Pipelines Kommo.rtf`.
- [ ] **Kommo – Custom fields**: ID de PLATFORM (887302), CBU, alias (los confirmamos
      con `GET /api/v4/leads/custom_fields`).
- [ ] **Meta – Pixel/Dataset ID** (visto: 1131496748897137).
- [ ] **Meta – Conversions API Access Token** (Events Manager → Configuración → CAPI).
- [ ] **Meta – Test Event Code** para dev.

---

## 8. Orden de implementación (milestones)

1. **Scaffold**: Next.js + Postgres (Prisma/Drizzle) + esquema de tablas. Deploy a Vercel.
2. **`lib/meta.ts`** con `sendCapiEvent` + test contra Events Manager (Test Event Code).
3. **`/api/webhooks/kommo`**: log + upsert lead. Verificar que llegan los webhooks reales.
4. **Disparo `ConversacionCRM`** desde el webhook de conversación.
5. **`/convertidos`** (panel mínimo) + **`/api/convert`** → dispara `CargoCRM`.
6. **Dedup + reintentos** (eventos `failed` se reintentan). Auditoría en `meta_events`.
7. (Fase 2) Reportes con filtro por `campaign_id`, export, y landing con captación de fbclid.

---

## 9. Fuera del MVP (fases siguientes)

- Landing propia (capta fbclid/fbp/fbc, rota números por tipo Publi/Spam/Regular, token único).
- Salesbots replicados (WELCOME, CREO_USUARIO, CBU, CARGO, REVISAR_IMAGE, SEGUIMIENTO).
- IA para detectar comprobante → mover a "Revisar Imagen".
- Panel completo (Config: CBU, contexto IA, bono, números; Reportes; Deploy de landings).
- Multi-cuenta (varias cuentas tipo "Administración Group SAS...").
```

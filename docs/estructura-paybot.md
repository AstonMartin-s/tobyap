# Estructura completa del sistema Paybot / Kommo — Documento exhaustivo

> Mapa funcional y técnico del sistema, reconstruido desde la documentación, el panel (`kommo.paybot.app`) y todas las APIs que lo alimentan. Capturado a máximo detalle, incluyendo campos, valores y comportamientos menores.
> Relevado: 2026-06-27. No incluye claves, tokens ni datos personales en claro.

---

## 1. Qué es el sistema

Plataforma de **tracking de conversiones publicitarias para operadores de apuestas/casino**, multi-cliente. Conecta:

1. **Meta (Facebook Ads)** → campañas, cuentas publicitarias, gasto, insights.
2. **Kommo (CRM sobre WhatsApp)** → conversaciones y "cargas" (depósitos) de cada lead.
3. **Landings / redirects propios** (deploys en Vercel) → capturan la visita y disparan eventos hacia Meta (Conversions API).
4. **Bot de detección de imágenes** → hoy es el único automatismo en uso: cuando un lead manda una imagen por el CRM, la detecta y mueve el lead a "Revisar Imagen". El resto de la lógica de clasificación por IA (prompt + reglas de §6.4/§6.5) está configurada pero **no está en uso actualmente**.

Cada **cliente** = una marca/operador con su subdominio, su base de Kommo, sus cuentas de ads y sus landings. El sistema mide visitas → conversaciones → cargas y lo cruza con el gasto en ads (costo por chat, costo por carga, % conversión).

---

## 2. Arquitectura — componentes y hosts

```
┌──────────────────────────────────────────────────────────────────────┐
│  FRONTEND  ·  kommo.paybot.app   (Next.js)                            │
│   • /        → Panel de CLIENTE (configuración del bot)               │
│   • /admin   → Panel ADMIN (reportes de todos los clientes)          │
│   Login: Firebase Auth (Identity Toolkit, API key pública)           │
└───────┬───────────────────────┬──────────────────────┬───────────────┘
        │                       │                       │
        ▼                       ▼                       ▼
┌────────────────┐  ┌──────────────────────┐  ┌────────────────────────┐
│ AUTH/ADMIN API │  │ API POR CLIENTE       │  │ DEPLOY SERVICE         │
│ paybot-auth    │  │ <subdomain>.paybot.app│  │ api-deploys-frames     │
│ .vercel.app    │  │  (proxy → Kommo v4)   │  │ .vercel.app            │
│ • /api/auth    │  │ • /api/settings       │  │ • /api/project-env     │
│ • /api/ad-     │  │ • /api/status         │  │ • /api/project-env-    │
│   manager      │  │ • /api/rules          │  │   redeploy             │
│                │  │ • /api/pipelines      │  │ (crea/actualiza        │
│                │  │ • /api/pipelines/     │  │  landings en Vercel)   │
│                │  │   statuses            │  │                        │
└───────┬────────┘  └──────────┬────────────┘  └────────────────────────┘
        │                      │
        ▼                      ▼
┌────────────────┐   ┌────────────────────────────┐
│ META GRAPH API │   │ KOMMO  <subdomain>.kommo.com│
│ (ads/insights) │   │ /api/v4 (leads, pipelines)  │
└────────────────┘   └────────────────────────────┘
        │
        ▼
┌────────────────────────────────────────────────────────┐
│ API EXTERNA por cliente (del doc original)             │
│ api-paybot-crmpaybotN-xxxx.vercel.app                  │
│ • GET /api/external/conversions   (auth: x-api-key)    │
└────────────────────────────────────────────────────────┘
```

**Tres niveles de autenticación distintos:**
| Capa | Host | Auth |
|---|---|---|
| Admin / Auth (global) | `paybot-auth.vercel.app` | `Authorization: Bearer <token Firebase>` |
| Cliente (config) | `<subdomain>.paybot.app` | Bearer Firebase (mismo token) |
| Externa (terceros, por cliente) | `…crmpaybotN….vercel.app` | `x-api-key: pbx_ext_live_…` |

---

## 3. AUTENTICACIÓN

- **Proveedor:** Firebase Authentication (Google Identity Toolkit). API key pública embebida en el front (`AIzaSy…`).
- **Login:** email + password en el panel → token de sesión (`stsTokenManager.accessToken`) guardado en **IndexedDB** (`firebaseLocalStorageDb`), no en localStorage.
- **Uso:** todas las llamadas a `paybot-auth` y `<subdomain>.paybot.app` mandan `Authorization: Bearer <token>`.
- **Endpoint `/api/auth`** (en `paybot-auth.vercel.app`):
  - `GET` → con token admin devuelve **todos los documentos de clientes** (23 relevados).
  - `POST` → login / validación de sesión.
  - `PATCH` → muta el documento del cliente mediante "acciones" (ver landings §6.4): `add_landing`, `update_landing`, `remove_landing`.

---

## 4. DOCUMENTO DE CLIENTE (la entidad central)

Devuelto por `/api/auth`. Un documento por cliente (23 en total). Campos:

| Campo | Descripción |
|---|---|
| `uid` | ID Firebase del cliente |
| `subdomain` | Subdominio (ej. `mooneyatkinson`) → define `<subdomain>.paybot.app` y `<subdomain>.kommo.com` |
| `email` | Email de login del cliente |
| `pipeline_id` | ID del pipeline de Kommo en uso (ej. `12175667`) |
| `settings_id` | ID del documento de configuración (Mongo) |
| `api_url` | URL de su API externa (ej. `https://<subdomain>.paybot.app`) |
| `kommo_db` | Nombre de la base Mongo de eventos del cliente (ej. `kommo-money-maker`) |
| `platform` | Plataforma de ads (meta) |
| `psp_active` | Si tiene PSP (proveedor de pagos) activo |
| `psp_key` | Clave del PSP |
| `rol` | Rol del documento (cliente/admin) |
| `landings` | Array de landings (ver §6) |
| `project_id` | ID de proyecto Vercel asociado |
| `event_index` | Índice/sufijo de eventos del cliente (el `n` de `CRMn`) |
| `updatedAt` | Última modificación |

---

## 5. API ADMIN — `paybot-auth.vercel.app/api/ad-manager`

Endpoint maestro con parámetro `type`. Valores válidos: **`accounts`, `campaigns`, `insights`, `report`, `events`**. Rutas dedicadas equivalentes: `/api/ad-manager/campaigns`, `/api/ad-manager/reports`.

### 5.1 `type=accounts` — Cuentas publicitarias de Meta
6 cuentas relevadas. Campos: `id` (`act_…`), `account_id`, `name` (ej. "Verst3", "MM B4"), `account_status` (1=activa), `currency` (USD), `timezone_name` (America/Buenos_Aires), `owner` (ID Meta).

### 5.2 `type=campaigns` — Campañas (121 relevadas)
Filtros: `uid`, `account_id`, `campaign_id`, `status`, `since`, `until`.
Campos por campaña: `campaign_id`, `campaign_name`, `ref`, `account_id`, `account_name`, `email`, `subdomain`, `uid`, `objective` (OUTCOME_LEADS), `platform` (meta), `status` (ACTIVE…), `daily_budget`, `lifetime_budget`, `created_at`, `updated_at`.

### 5.3 `type=report` (`/api/ad-manager/reports?date=YYYY-MM-DD`) — Reporte diario
Devuelve `success`, `date`, `total_clients` (21) y `data[]` (una fila por cliente). Para un cliente puntual: `uid`.
Estructura por cliente:
| Grupo | Campo | Descripción |
|---|---|---|
| raíz | `uid`, `subdomain`, `email`, `api_url` | Identidad + URL externa |
| `events` | `event1Count` | **Conversaciones** (evento 1) |
| `events` | `event2Count` | **Cargas/depósitos** (evento 2) |
| `events` | `totalRedirects` | **Visitas** |
| `events` | `totalEvents`, `eventTypes`, `records` | Totales/tipos/registros |
| `spend` | `total_spend` | Gasto en ads (USD) |
| `spend` | `campaigns_count` | Nº campañas con gasto |
| `metrics` | `costo_por_chat` | Gasto ÷ conversaciones |
| `metrics` | `costo_por_carga` | Gasto ÷ cargas |
| `metrics` | `conversion` | % de conversión |

### 5.4 `type=insights` — Métricas en vivo de Meta
Requiere `campaign_id`, `since`, `until`. Consulta directa a la Graph API de Meta (gasto/impresiones/resultados). Depende de permisos vigentes del token de Meta (varias campañas dieron `GraphMethodException` por permisos/objeto inexistente).

### 5.5 `type=events` — Eventos crudos (capa más profunda)
Requiere `uid`. Filtros: `campaign_id`, `event_name`, `since`, `until`.
Devuelve: `kommo_db`, `total`, `events_summary` (conteo por tipo, ej. `ConversacionCRM2`: 67.516 / `CargoCRM2`: 14.063) y `data[]`.
Campos por evento: `_id`, `conversionData` (payload a Meta CAPI: `event_name`, `event_time`, `action_source`, `event_source_url`, `user_data`), `campaignId`, `messageData` (mensaje de Kommo origen), `extractedCode` (código de carga extraído), `conversionResults` (respuesta de Meta), `metaCampaignId`, `metaCampaignName`, `metaAdId`, `metaAdName`, `timestamp`, `success`.

> **Capa más sensible:** expone los `user_data` de cada lead enviados a Meta (hasheados) y los mensajes de WhatsApp.

---

## 6. API DE CLIENTE — `<subdomain>.paybot.app`

Lee/escribe la configuración del cliente. Es **proxy hacia Kommo** (`<subdomain>.kommo.com/api/v4`). Datos en MongoDB.

### 6.1 `/api/settings` — Configuración General
| Campo | Descripción | Ejemplo (mooneyatkinson) |
|---|---|---|
| `accountName` | Nombre de la cuenta | "Administración Group SAS 885 Rojas Lautaro" |
| `accountCBU` | CBU para transferencias | (numérico) |
| `context` | **Prompt del Asistente IA** | ver §6.5 |
| `message` | Mensaje/bono de bienvenida | "Hola vi el anuncio y quiero mi beneficio" |
| `regularMessage` | Mensaje para leads "regulares" | "." |
| `walink` | Número base de link de WhatsApp | "1150120516" |
| `numbers` | Array de números de contacto | ver §6.2 |
| `_id`, `updatedAt` | Metadatos | |

### 6.2 `numbers` — Números de contacto
Cada número: `name`, `phone`, `status` (bool activo), `type`. Tipos observados: **`publi`** (publicidad), **`regular`**, **`spam`**, **`soporte`**.
15 números relevados (ej.: "Agro Norte" 549116433…/publi/activo; "Ganadera Agro" /spam; "Dogzee" /soporte; varios "regular" inactivos).

### 6.3 `/api/status` — Estados del Sistema (9)
Espejo en Mongo de los estados del pipeline Kommo. Campos: `_id`, `statusId`, `name`, `description`, `kommo_id`, `color`, `createdAt`, `updatedAt`.

| statusId | Nombre | Color | Descripción |
|---|---|---|---|
| 94051815 | Leads Entrantes | #c1c1c1 | Mensajes recién llegados sin asignar |
| 94052139 | Seguimiento | #ffce5a | Seguimiento |
| 95071144 | Revisar imagen | #99ccff | Usuario envía imagen → se crea solicitud de pago |
| 94052131 | No Atender | #ff8f92 | Lead no calificado (niños, bromistas, vulgares…) |
| 94052135 | No Cargo | #d6eaff | Lleva tiempo sin cargar o repite sin concretar |
| 94052123 | Pidio CBU/Alias | #98cbff | Solicita datos bancarios para transferir |
| 94051823 | Revisar | #ffff99 | Dudas/consultas fuera de flujo (comodín) |
| 94051827 | Pidio Usuario | #ccc8f9 | Usuario creado por API automáticamente |
| 94052127 | Cargo$ | #87f2c0 | Informativo, manual, representa nuevo cliente |

> **Estado de uso (importante):** hoy el bot de IA **no está operativo para clasificar mensajes**. El único automatismo activo es la **detección de imágenes**: cuando un lead envía una imagen por el CRM, se la detecta y se mueve el lead al estado **"Revisar Imagen"** (statusId 95071144) para revisión/carga manual. El `context` (§6.5) y las 17 reglas (abajo) quedan como configuración disponible pero **no se están aplicando** mientras el clasificador esté apagado.

### 6.4 `/api/rules` — Reglas del clasificador IA (17) — *configuradas, no en uso*
Paginado: `rules`, `total`, `limit`, `offset`, `hasMore`, `query`.
Campos por regla: `_id`, `rule` (instrucción en lenguaje natural), `text` (etiqueta/estado destino), `crm` (kommo), `pipeline` (sales), `priority` (1–2), `status` (active), `createdAt`, `updatedAt`.

Reglas relevadas (resumen):
1. (p1) text vacío + attachment → "Revisar Imagen"
2. (p1) "Quiero mi B0NUS" → pidioUsuario
3. (p1) tras código de promo + "Hola, vi el anuncio…" → NO crear usuario, NO cambiar status
4. (p1) "Quiero depositar" → pidioCbuAlias
5. (p1) Nombre completo tras attachment → datos de comprobante, no recrear usuario
6. (p2) repite nombre → mantener status (no duplicar usuario)
7. (p1) text vacío únicamente → Revisar Imagen
8. (p1) nombre/apodo → "Pidio usuario"
9. (p1) si no aporta info nueva → mantener
10. (p1) cambiar solo con razón clara y específica
11. (p1) analizar contenido literal + contexto del status
12. (p1) "Revisar" = comodín para consultas
13. (p1) "NoCargo" = inacción prolongada
14. (p1) "No atender" = clientes no deseados
15. (p1) **NUNCA cambiar a status "Cargo"**
16. (p1) informa transferencia → "Revisar Imagen" (confirmación manual)
17. (p1) el razonamiento debe explicar por qué cambia/mantiene el status

### 6.5 El prompt del bot (`settings.context`) — texto íntegro
```
Eres un asistente de IA especializado en clasificar mensajes de clientes potenciales en un CRM
Tu objetivo es analizar mensajes ENTRANTES de clientes y decidir si corresponde cambiar el status del Lead.
El status refleja el punto en el flujo comercial/operativo en el que se encuentra el cliente.
Si te pasan un nombre, significa que 'pidioUsuario'

IMPORTANTE – RESTRICCIÓN CRÍTICA:
1) NUNCA PROCESAR MENSAJES REPETIDOS. MISMA HORA DE CREACION, DISTINTA HORA DE UPDATE ES === A MISMO MENSAJE.
2) NUNCA, BAJO NINGUNA CIRCUNSTANCIA, puedes cambiar el status a "Cargo".
3) LAS IMAGENES O MENSAJES CON ATTACHMENT SE DEBE ENVIAR A REVISAR IMAGEN
4) SI MANDA MENSAJE DE BIENVENIDA CON CODIGO DE PROMOCION Y 'Hola, vi el anuncio y quiero mi beneficio.' NO CAMBIAR STATUS. MANTENER

Esto incluye:
Mensajes confirmando transferencias realizadas
Comprobantes de pago enviados
Cualquier confirmación de carga exitosa
Mensajes que indiquen que ya transfirieron el dinero
```

### 6.6 `/api/pipelines` y `/api/pipelines/statuses`
- `/api/pipelines` → proxy a `<subdomain>.kommo.com/api/v4/leads/pipelines`. Devuelve `_total_items`, `_embedded.pipelines[]` con `id`, `name`, `sort`, `is_main`, `is_unsorted_on`, `is_archive`. (Ej.: pipeline "Publicidad (LEGACY)" id 12175667; 23 items.)
- `/api/pipelines/statuses?pipeline_id=` → `pipeline_id`, `pipeline_name`, `statuses[]` (`id`, `name`, `color`, `pipeline_id`), `total_statuses`. Estados Kommo: Incoming leads, Revisar, Pidio Usuario, etc.

---

## 7. LANDINGS — entorno unificado de deploy

Conceptualmente es lo más simple del sistema: **un único servicio centralizado que se encarga de crear y desplegar las landings en un host** (Vercel), parametrizadas por cliente. No hay lógica compleja: es "tomá estos datos del cliente → generá/redeployá una página → guardá su URL".

Dos piezas:
- **Registro:** las landings **viven dentro del documento de cliente** (`landings[]`) y se gestionan vía `PATCH /api/auth` (alta/baja/edición). Ahí queda la URL, el tipo y el estado.
- **Deploy:** un **servicio único y compartido** (`api-deploys-frames.vercel.app`, el "entorno unido") que recibe los parámetros del cliente y despliega/actualiza el proyecto Vercel de esa landing con sus variables de entorno.

En la práctica: el panel manda los datos → el servicio de deploy crea/actualiza la página en el host → devuelve la URL → se guarda en `landings[]` del cliente. Es el mismo motor para todos los clientes; lo único que cambia son las variables (`NEXT_PUBLIC_*`) de marca, pixel y mensaje.

### 7.1 Objeto landing
| Campo | Descripción |
|---|---|
| `_id` | ID en Mongo |
| `url` | URL del redirect (ej. `https://guba-redirect-888.vercel.app`) |
| `type` | `publi` (publicidad) o `regular` |
| `active` | Activa/inactiva |
| `environments` | Ej. `["production"]` |
| `db` | Base Kommo asociada (ej. `kommo-money-maker`) |
| `vercel` | `{ project, name, target ("production"), gitSource:{ ref:"main", repoId, type:"github" } }` |
| `createdAt`, `updatedAt` | Timestamps |

13 landings en mooneyatkinson (guba-redirect-888…892, guba-only-number, mooney-maker-regulares, mooneyatkinson-landing-1779…, etc.).

### 7.2 Acciones (vía `PATCH /api/auth`)
- `add_landing` — agregar
- `update_landing` — editar (incl. `{landing_id, active}` para activar/desactivar)
- `remove_landing` — eliminar (`{landing_id}`)

### 7.3 Servicio de deploy — `api-deploys-frames.vercel.app`
Configurado en el front como `NEXT_PUBLIC_DEPLOY_LANDING_SERVICE`.
- `POST /api/project-env` — setea variables de entorno del proyecto Vercel de la landing.
- `POST /api/project-env-redeploy` — redeploya con nuevas envs. Body: `{ projectId, landing_url, api_url, … }`.

### 7.4 Variables de entorno de una landing (las `NEXT_PUBLIC_*`)
`NEXT_PUBLIC_TITLE`, `NEXT_PUBLIC_DESCRIPTION`, `NEXT_PUBLIC_APP_NAME`, `NEXT_PUBLIC_THEME_COLOR`, `NEXT_PUBLIC_FAVICON_URL`, `NEXT_PUBLIC_LOGO_URL`, `NEXT_PUBLIC_BRAND_PRIMARY_COLOR`, `NEXT_PUBLIC_BRAND_SECONDARY_COLOR`, `NEXT_PUBLIC_META_PIXEL_ID`, `NEXT_PUBLIC_API_TOKEN`, `NEXT_PUBLIC_API_NUMBER`, `NEXT_PUBLIC_AGENT_NAME`, `NEXT_PUBLIC_LANDING_TYPE` (publi/regular), `NEXT_PUBLIC_DEFAULT_MESSAGE` (admite plantillas `{{…}}`), `NEXT_PUBLIC_LOCALE`, `NEXT_PUBLIC_REDIRECT_DELAY_MS`.

> Cada landing es su propio proyecto Vercel: una página de marca con pixel de Meta que, tras un delay, redirige a WhatsApp con el mensaje por defecto. El sistema las crea/edita/redeploya desde el panel.

---

## 8. API EXTERNA (terceros, por cliente) — `…crmpaybotN….vercel.app`

Para que otra API consulte la data de **un solo cliente**. Documentada en `api-external-conversions.md`.
- **Endpoint único:** `GET /api/external/conversions` (las ~14 rutas hermanas dan 404).
- **Auth:** `x-api-key: pbx_ext_live_…` (o `Authorization: Bearer`, o `?api_token=`). Clave hardcodeada por deploy.
- **Filtros:** `campaignId`, `startDate`, `endDate`, `eventName`, `eventSourceUrl`, `includeRecords`.
- **Devuelve:** `conversiones.count` (ev.1), `cargas.count` (ev.2), `totalRedirects`, `totalEvents`, `eventTypes`, `records[]` (si `includeRecords=true`).
- **Ojo:** cada cliente tiene su propio número de proyecto Vercel (no adivinable) y su propia key. `kommo.paybot.app` NO sirve esta API (tiene la auth admin).

---

## 9. MODELO DE DATOS — entidades y relaciones

```
CLIENTE (uid, subdomain, email, pipeline_id, settings_id, api_url,
         kommo_db, platform, psp_active, psp_key, event_index, project_id)
   │
   ├──> SETTINGS (accountName, accountCBU, context, message,
   │              regularMessage, walink, numbers[])
   │
   ├──< NUMBER (name, phone, status, type: publi|regular|spam|soporte)
   │
   ├──< STATUS (statusId, name, description, color, kommo_id)   ⇄ pipeline Kommo
   │
   ├──< RULE (rule, text, crm, pipeline, priority, status)
   │
   ├──< LANDING (url, type, active, db, environments, vercel{…})
   │        └─ deploy en Vercel con envs NEXT_PUBLIC_* (pixel, mensaje, marca)
   │
   ├──< CUENTA DE ADS (account_id, name, currency, timezone, owner)   [Meta]
   │        └──< CAMPAÑA (campaign_id, ref, objective, budgets, status)
   │                 └──< INSIGHTS (gasto, impresiones, resultados)   [Meta vivo]
   │
   └──< EVENTO (conversionData, messageData, extractedCode,
                metaCampaignId/Name, metaAdId/Name, success, timestamp)  [Kommo/Mongo]
            • ConversacionCRMn  → conversación (evento 1)
            • CargoCRMn         → carga/depósito (evento 2)
```

**Convención `CRMn`:** el sufijo `n` (= `event_index` del cliente) identifica al operador: CRM2 = mooneyatkinson, CRM13 = paybotcrm13, CRM18 = crmpaybot18. Cada `kommo_db` solo contiene sus propios eventos.

---

## 10. FLUJO COMPLETO (de punta a punta)

```
CONFIGURACIÓN (cliente, panel /):
  settings.context + rules  →  definen cómo clasifica el bot
  status                    →  estados disponibles del pipeline
  landings                  →  páginas con pixel que redirigen a WhatsApp
  numbers                   →  números rotativos de contacto

OPERACIÓN (por lead):
  1. Usuario ve anuncio en Meta → click
  2. Cae en la LANDING (pixel Meta) → se registra REDIRECT (visita)
  3. Delay → redirige a WhatsApp con NEXT_PUBLIC_DEFAULT_MESSAGE
  4. Inicia conversación en Kommo → evento ConversacionCRMn  (EVENTO 1)
  5. [HOY] Si el lead envía una imagen → el bot la detecta y lo mueve a "Revisar Imagen"
     (la clasificación por IA con context+rules está apagada por ahora)
  6. Operador revisa la imagen/comprobante → registra la carga (manual)
     → evento CargoCRMn  (EVENTO 2)
  7. Ambos eventos → Meta Conversions API (con user_data)

MEDICIÓN (admin, panel /admin):
  8. type=events cruza eventos (Kommo) con type=campaigns/insights (gasto Meta)
  9. report → costo_por_chat, costo_por_carga, % conversión por cliente y día
 10. Terceros consultan vía /api/external/conversions (1 cliente, x-api-key)
```

---

## 11. INVENTARIO DE CLIENTES (23 documentos; 11 con campañas)

| Subdominio | Email | Campañas | kommo_db / cuentas de ads |
|---|---|---|---|
| mooneyatkinson | mooneyatkinson@gmail.com | 55 | kommo-money-maker; INVOLTEABLE1, MM B3-B6, Mooney Mia, Verst3, Golden 3 |
| frangigi21 | frangigi21@gmail.com | 16 | New West, Spider 1 |
| oneplay423 | oneplay423@gmail.com | 12 | Verst3, Verst1, Golden 2 |
| publigreenbetmia | publigreenbet.mia@gmail.com | 11 | New Maker |
| (publicidad2luz) | publicidad2luzgreenbet@gmail.com | 9 | New Maker, New West, Spider 1 |
| paybotcrm13 | paybot.crm13@gmail.com | 6 | Benito Cardal, Verst1, New West |
| (yoelurquiza) | yoelurquiza1997@gmail.com | 5 | Verst1, Verst2 |
| acctsadon | accts.adon@gmail.com | 2 | Verst1 |
| eduardotobiasdiaz | eduardotobiasdiaz@gmail.com | 2 | New Maker |
| santocirco | focusads.a@gmail.com | 2 | Verst1 |
| (badbuild) | nazareno@badbuildanddesign.com.ar | 1 | BigBag24 |

Subdominios presentes sin campañas activas: solganamos2312, nicolas, paybotcrm15, crmpaybot17, japonymaidana, fsmilerville, crmpaybot18, "all".

---

## 12. NOTAS DE SEGURIDAD (observadas)

- **API externa**: clave hardcodeada por deploy; el doc advierte rotarla si se filtra. La clave de un cliente da acceso de lectura a sus conversiones/cargas/records.
- **`type=events`**: expone los payloads crudos a Meta, con `user_data` de los leads (datos personales hasheados) y mensajes de WhatsApp. Capa más sensible.
- **`psp_key`** queda en el documento de cliente (clave del proveedor de pagos) → tratar como secreto.
- **`NEXT_PUBLIC_API_TOKEN`** se inyecta en las landings: al ser `NEXT_PUBLIC_*`, queda **expuesto en el bundle público** de cada landing.
- **Auth admin** = Firebase email+password. Recomendado MFA y rotación periódica de credenciales.
- `insights` depende de tokens de Meta con permisos vigentes (varias campañas dieron error de permisos).

---

## 13. RESUMEN DE ENDPOINTS (referencia rápida)

| Host | Endpoint | Método | Función |
|---|---|---|---|
| paybot-auth | `/api/auth` | GET/POST/PATCH | Sesión + documentos de cliente + mutar landings |
| paybot-auth | `/api/ad-manager?type=accounts` | GET | Cuentas de Meta |
| paybot-auth | `/api/ad-manager?type=campaigns` | GET | Campañas (121) |
| paybot-auth | `/api/ad-manager?type=report&date=` | GET | Reporte diario por cliente |
| paybot-auth | `/api/ad-manager?type=insights` | GET | Insights de Meta (campaign_id, since, until) |
| paybot-auth | `/api/ad-manager?type=events&uid=` | GET | Eventos crudos por cliente |
| &lt;subdomain&gt;.paybot.app | `/api/settings` | GET | Configuración general |
| &lt;subdomain&gt;.paybot.app | `/api/status` | GET | Estados del sistema |
| &lt;subdomain&gt;.paybot.app | `/api/rules` | GET | Reglas del bot |
| &lt;subdomain&gt;.paybot.app | `/api/pipelines` | GET | Pipelines (proxy Kommo) |
| &lt;subdomain&gt;.paybot.app | `/api/pipelines/statuses?pipeline_id=` | GET | Estados de un pipeline |
| api-deploys-frames | `/api/project-env` | POST | Setear envs de una landing |
| api-deploys-frames | `/api/project-env-redeploy` | POST | Redeploy de una landing |
| …crmpaybotN… | `/api/external/conversions` | GET | API externa por cliente (x-api-key) |

---

*Documento estructural exhaustivo. No incluye claves, tokens ni datos personales en claro. Para histórico de métricas: recorrer `report` por fecha o `events` por `uid` con `since`/`until`.*

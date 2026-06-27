# Prompts para Cursor — TOBYAP (por fases, alineado a estructura-paybot.md)

> Stack confirmado: **Next.js (App Router, TS) + Postgres (Drizzle) + Vercel**, auth propia
> (NO Firebase), eventos en **Postgres multi-tenant** (NO Mongo). Toda la estructura
> funcional del documento `estructura-paybot.md` se aplica sobre este stack.
>
> El **modelo de datos completo ya está en `db/schema.ts`** (tenants ampliado + client_settings,
> numbers, statuses, rules, landings, ad_accounts, campaigns, meta_events enriquecido).
> Cada fase implementa la lógica/endpoints sobre esas tablas. Pegá los prompts en orden.
>
> Referencias: `@estructura-paybot.md` (mapa funcional) y `@PLAN.md`. Secciones §X = del doc.

---

## FASE 0 — Ya hecho (MVP)
Scaffold, cifrado AES, `tenants/leads/meta_events`, webhook Kommo→Meta, panel mínimo,
conversión manual (CargoCRM). Tenant de prueba `crmmattdamon` validado contra Kommo y Meta.

---

## FASE 1 — Migración del schema ampliado + alta de cliente completa

```
El archivo db/schema.ts ya tiene las tablas nuevas (client_settings, numbers, statuses,
rules, landings, ad_accounts, campaigns) y campos extra en tenants y meta_events.

1. Generá y aplicá la migración Drizzle (db:generate + db:push).
2. Ampliá lib/tenants.ts -> createTenant para que, además de los campos actuales, acepte
   y persista: role, platform, apiUrl, kommoDb, projectId, pspActive, pspKey (cifrado),
   externalApiKey (cifrado). Y opcionalmente un bloque "settings" (accountName, accountCbu,
   context, message, regularMessage, walink) que se inserta en client_settings, y arrays
   "numbers" y "rules" que se insertan en sus tablas.
3. Actualizá scripts/seed-tenant.ts y tenants/example.json para reflejar el documento de
   cliente completo (§4) con settings + numbers + rules de ejemplo.
4. Agregá un comando para sincronizar los estados del pipeline de Kommo a la tabla statuses:
   scripts/sync-statuses.ts <slug> que llame a Kommo /api/v4/leads/pipelines/{pipeline_id}
   y haga upsert en statuses (kommoStatusId, name, color, pipelineId).
```

---

## FASE 2 — Panel de CLIENTE (§6): settings, numbers, statuses, rules

```
Construí el panel del cliente (ruta /, protegida por sesión de tenant), replicando §6 del
documento, pero leyendo/escribiendo en Postgres (no Mongo):

- /api/settings (GET/PUT): client_settings del tenant logueado (accountName, accountCbu,
  context, message, regularMessage, walink).
- /api/numbers (GET/POST/PATCH/DELETE): CRUD de numbers (name, phone, status, type:
  publi|regular|spam|soporte).
- /api/status (GET): lee statuses del tenant (espejo del pipeline). Botón "Sincronizar"
  que dispara la sync desde Kommo (Fase 1.4).
- /api/rules (GET/POST/PATCH/DELETE): CRUD de rules con paginado (limit/offset/hasMore).
- /api/pipelines y /api/pipelines/statuses: proxy de solo lectura a
  <subdomain>.kommo.com/api/v4 usando el token del tenant (descifrado).

UI mínima con Tailwind: secciones Configuración General, Números, Estados, Reglas.
Mantené el flag de que el clasificador IA está APAGADO (las rules se muestran/editan
pero no se ejecutan todavía — ver Fase 5).
```

---

## FASE 3 — Panel ADMIN + Reportes (§5)

> **HECHO:** `/admin` con reporte por cliente (conversaciones / cargas / redirects / %conv),
> leyendo SOLO de nuestra DB (`lib/reports.ts` → `meta_events`). Filtro por rango de fechas.
> **PENDIENTE (a pedido del usuario, 2026-06-27):** conexión de **gasto de Meta Ads**
> (`lib/meta-ads.ts`: accounts/campaigns/insights) y métricas **costo_por_chat / costo_por_carga**.
> El usuario tiene que ajustar cosas del lado de Meta antes. Retomar cuando avise.

```
Construí el panel admin (ruta /admin, solo tenants con role='admin') con el cruce de
eventos (Kommo/Postgres) y gasto de Meta, replicando §5 del documento:

- lib/meta-ads.ts: cliente de la Graph API de Meta para traer accounts (act_...),
  campaigns (por account_id) e insights (gasto/impresiones/resultados por campaign_id,
  since, until). Persistí accounts en ad_accounts y campaigns en campaigns (upsert).
- /api/ad-manager?type=accounts|campaigns|insights|report|events  (un endpoint maestro):
  * report (?date=YYYY-MM-DD): por cada tenant calcula desde meta_events:
      event1Count = ConversacionCRM<suffix>, event2Count = CargoCRM<suffix>,
      totalRedirects = eventType 'redirect'. Cruza con total_spend (suma insights del día)
      y devuelve metrics: costo_por_chat (spend/event1), costo_por_carga (spend/event2),
      conversion (event2/event1 %).
  * events (?uid=): eventos crudos del tenant con filtros campaign_id, event_name,
      since, until + events_summary (conteo por tipo).
- UI admin: tabla por cliente (subdomain, event1, event2, redirects, spend, costo_chat,
  costo_carga, %conv) con date picker y export CSV.

Auth admin: misma sesión propia, pero el endpoint exige role='admin'.
```

---

## FASE 4 — Landings + servicio de deploy (§7)

```
Implementá la gestión de landings sobre la tabla landings + un servicio de deploy:

- /api/landings (GET/POST/PATCH/DELETE) equivalente a las acciones add_landing /
  update_landing / remove_landing del documento. Cada landing: url, type (publi|regular),
  active, environments, db, vercel{project,name,target,gitSource}.
- lib/vercel-deploy.ts: integración con la API de Vercel para setear env vars del proyecto
  de la landing (NEXT_PUBLIC_*) y disparar redeploy. Variables de §7.4 (TITLE, PIXEL_ID,
  API_TOKEN, API_NUMBER, AGENT_NAME, LANDING_TYPE, DEFAULT_MESSAGE, branding...).
- Un template de landing (carpeta templates/landing) Next.js mínima: página de marca con
  Meta Pixel que, tras NEXT_PUBLIC_REDIRECT_DELAY_MS, redirige a WhatsApp con el mensaje,
  capturando fbclid/fbp/fbc y registrando el REDIRECT (eventType 'redirect') vía la API.

OJO seguridad: NEXT_PUBLIC_API_TOKEN queda expuesto en el bundle de la landing (§12).
Usá un token de bajo privilegio solo para registrar redirects, no el token admin.
```

---

## FASE 5 — Automatismo de imágenes + (opcional) clasificador IA (§6.4/§6.5)

```
- Detección de imágenes (ÚNICO automatismo activo hoy): en el webhook de Kommo, si el
  mensaje entrante trae attachment/imagen, mover el lead al estado "Revisar Imagen"
  (status_revisar_imagen del customFields del tenant) vía Kommo /api/v4/leads/{id}.
- (Opcional, apagado por defecto) Clasificador IA: lib/classifier.ts que, con el
  openaiApiKey del tenant, aplica context (§6.5) + rules para sugerir cambio de status.
  Controlado por un flag por tenant (ai_classifier_enabled, default false). NUNCA cambiar
  a status "Cargo" (regla 15). Loggear el razonamiento.
```

---

## FASE 6 — API externa por cliente (§8)

```
- /api/external/conversions (GET) protegido por x-api-key == tenant.externalApiKey
  (descifrado). Filtros: campaignId, startDate, endDate, eventName, eventSourceUrl,
  includeRecords. Devuelve conversiones.count (event1), cargas.count (event2),
  totalRedirects, totalEvents, eventTypes, records[] (si includeRecords).
- Rate-limit básico por api-key. Clave generable/rotable desde el panel admin.
```

---

## Notas transversales (aplican a todas las fases)
- Multi-tenant: todo filtra por tenant_id. Webhook entra por /api/webhooks/kommo/[slug].
- Convención de eventos: nombre = `Conversacion`/`Cargo` + `CRM` + `event_suffix`.
- Secretos cifrados en DB (lib/crypto). Nunca `NEXT_PUBLIC_*` para tokens admin.
- Atribución: en cuentas como crmmattdamon viene de custom fields (fbclid 262180,
  utm_campaign 262166), no de fbp/fbc de landing. `lib/meta.ts` debe soportar ambos.
- Dedup Meta por event_id estable (`${slug}:conv:${leadId}` / `${slug}:cargo:${leadId}`).
```

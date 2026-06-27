# TOBYAP — Resumen de trabajo + Handoff para Cursor

> Documento maestro: consolida todo lo definido y construido, y deja el objetivo listo
> para desarrollar la app en Cursor siguiendo `PROMPTS.md`. Alineado con `PLAN.md`.
> **Secretos:** no van en este archivo ni en el repo. Van en `.env` / DB cifrada.
> El titular rotará los access tokens al final del desarrollo (ver §7).

---

## 1. Qué es el sistema (alcance del build)

Sistema **multi-tenant de tracking de conversiones** para un negocio de casino online
con licencia en Argentina. Mide el embudo y lo reporta a Meta (Pixel + Conversions API)
con deduplicación por `event_id`. **Stack:** Next.js 14 (App Router, TS) + Postgres
(Drizzle) + Vercel.

**Lo que construimos = la capa de medición/CRM** (legítima, adtech estándar):

```
Anuncio Meta ─click→ Landing (capta fbclid/fbc/fbp/UTMs)
        └→ Kommo (CRM, guarda atribución en custom fields)
                └→ Webhook → backend → Meta CAPI (Conversación / Cargo)
```

> Fuera de alcance de este build: cualquier automatización de envío saliente o rotación
> de números de WhatsApp para repartir/ocultar volumen. El modelo aquí es **inbound**
> (el cliente inicia el chat desde el anuncio). Si se necesita mensajería saliente,
> se hace con la **WhatsApp Business Platform (Cloud API)** oficial, con opt-in/opt-out.

---

## 2. Lo que ya validamos (riesgo técnico despejado)

- ✅ **Kommo API**: token, pipeline y custom fields de tracking responden.
- ✅ **Meta Conversions API**: prueba real exitosa.
  - `events_received: 1`, `fbtrace_id: AYnUT_UeVtFWMyPLRQTCoxR`
  - Evento `ConversacionCRM30` aceptado en el dataset `1699551654171070`.
  - Token CAPI válido, formato de evento + dedup por `event_id` OK.

Conclusión: las dos integraciones críticas funcionan de punta a punta. Falta construir
el sistema que las orquesta multi-tenant (eso es lo que hace `PROMPTS.md`).

---

## 3. Decisiones de arquitectura tomadas en esta conversación

### 3.1 Atribución: el `fbclid` viene del ANUNCIO, no del CRM
- La **landing** captura `_fbc` / `_fbp` / `fbclid` + UTMs y los persiste (cookie 90 días).
- Se guardan en custom fields del lead en Kommo. **Kommo solo transporta**, no es la fuente.
- En CAPI se usa preferentemente el `_fbc` real capturado en la landing; solo si no
  existe, se arma `fb.1.<ts>.<fbclid>` como fallback.

### 3.2 Los dos eventos son SERVER-SIDE (CAPI), no de browser
| Evento | Disparador | `event_id` (determinístico) |
|--------|-----------|------------------------------|
| `ConversacionCRM<N>` | inicia chat (lead nuevo en Kommo) | `conv-<chatId\|leadId>` |
| `CargoCRM<N>` | lead pasa a etapa "cargo" del pipeline | `cargo-<leadId>` |

- **No** hay `fbq('track', conversión)` en la landing: esos eventos no ocurren con el
  usuario en la página, así que **el dedup browser↔CAPI no aplica**. El Pixel del browser
  queda solo para `PageView` + setear `_fbc`.
- El `event_id` es **determinístico** (derivado de IDs de Kommo) → un webhook que reintenta
  es **idempotente**, no cuenta doble.

### 3.3 Multi-tenant + secretos cifrados
- Config no sensible (pixel, pipeline, ids de campos) en claro; **tokens cifrados** AES-256-GCM.
- Descifrado solo en memoria al resolver el tenant. Cache 60s para poder rotar sin reiniciar.

---

## 4. Artefactos ya escritos en esta conversación (en ~/Downloads)

Listos para mover al proyecto en Cursor. Mapean directo a los prompts:

| Archivo | Va a | Prompt |
|---------|------|--------|
| `landing-captura-atribucion.html` | landing (captura fbclid/fbc/fbp + UTMs en hidden fields) | (pre-Prompt 4) |
| `meta.ts` | `lib/meta.ts` (cliente CAPI, hashing, event_id, 2 eventos) | PROMPT 3 |
| `kommo-webhook.ts` | `app/api/webhooks/kommo/[slug]/route.ts` | PROMPT 4 |
| `tenants.ts` | `lib/tenants.ts` (lookup + AES-256-GCM + cache) | PROMPT 2 |

> Ojo de alineación: en este chat usamos nombres `Conversacion/Cargo` y `action_source:
> 'business_messaging'`. `PLAN.md` propone `Lead/Purchase` + `action_source: website`.
> **Decisión recomendada:** mantener conversiones personalizadas `ConversacionCRM<N>` /
> `CargoCRM<N>` (ya validadas en Events Manager) y `action_source` según el origen real
> del evento. Unificar esto al ejecutar PROMPT 3.

---

## 5. Credenciales y pipeline YA ASIGNADOS (tenant de prueba)

Config **no secreta** del tenant de prueba `crmmattdamon` (los tokens van en `.env`/DB):

```json
{
  "slug": "crmmattdamon",
  "name": "Matt Damon (test)",
  "kommo_subdomain": "crmmattdamon",
  "kommo_token": "<EN_ENV>",
  "kommo_pipeline_id": 14006947,
  "meta_pixel_id": "1699551654171070",
  "meta_capi_token": "<EN_ENV>",
  "event_suffix": "30",
  "custom_fields": {
    "fbclid": 262180,
    "utm_campaign": 262166,
    "utm_source": 262168,
    "utm_content": 262162,
    "status_cargo": 108109007,
    "status_revisar_imagen": 108108343
  }
}
```

- `event_suffix: "30"` → eventos `ConversacionCRM30` / `CargoCRM30` (los validados).
- `status_cargo: 108109007` → es el `statusCargoId` que dispara `CargoCRM30` en el webhook.
- **Falta crear en Kommo** dos custom fields nuevos para `_fbc` y `_fbp` (hoy solo está
  `fbclid`). Agregar sus ids al tenant como `fieldFbc` / `fieldFbp`. Sin ellos, el sistema
  cae al fallback de reconstruir `fbc` desde `fbclid`.

---

## 6. Objetivo final: desarrollar en Cursor (orden de ejecución)

Seguir `PROMPTS.md` en orden; cada prompt deja algo funcionando:

1. **PROMPT 1** — Scaffold Next.js + Drizzle + `lib/crypto.ts` (AES-256-GCM) + tablas
   (`tenants`, `leads`, `meta_events`, `kommo_webhook_log`). Migración + `db:push`.
2. **PROMPT 2** — Alta de tenants (9 campos), cifrado de secretos, `getTenantBySlug`.
   → pegar `tenants.ts` de Downloads como base.
3. **PROMPT 3** — `lib/meta.ts` (CAPI) + `POST /api/test/capi?tenant=<slug>`.
   → pegar `meta.ts` de Downloads como base. **Replicar acá la prueba que ya pasó manual.**
4. **PROMPT 4** — `POST /api/webhooks/kommo/[slug]` → ConversacionCRM.
   → pegar `kommo-webhook.ts` de Downloads como base.
5. **PROMPT 5** — Panel mínimo + conversión manual (CargoCRM) con login por tenant.

**Hito de validación:** tras Prompt 3, cargar el tenant `crmmattdamon` y correr
`/api/test/capi?tenant=crmmattdamon` → confirmar el evento en
Events Manager → dataset `1699551654171070` → Eventos de prueba.

---

## 7. Seguridad — pendiente al cierre (lo definió el titular)

⚠️ Durante las pruebas se expusieron secretos reales (token Kommo, token Meta CAPI,
password del CRM). **El titular rotará los 3 access tokens al finalizar el desarrollo.**

Checklist de cierre:
- [ ] Rotar token Kommo, token Meta CAPI y password del CRM.
- [ ] Cargar los tokens **nuevos** ya cifrados (AES-256-GCM) en la DB; nunca en el repo.
- [ ] `ENCRYPTION_KEY` / `SECRETS_MASTER_KEY` (32 bytes hex) solo en ENV de Vercel.
- [ ] `ADMIN_TOKEN` para el alta de tenants, fuera del repo.
- [ ] Verificar dedup en Events Manager (que `ConversacionCRM30`/`CargoCRM30` no dupliquen).
- [ ] Scopes mínimos en los tokens (solo lo que el flujo necesita).

> Recomendación: aunque la rotación quede para el final, conviene hacerla **antes** de
> cualquier deploy público, porque los secretos viejos ya circularon.

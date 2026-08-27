# Lineamientos — Tracking de afiliados a bot de Telegram

> **Estado: LINEAMIENTOS / DISEÑO. No implementado.** Este documento es el contrato
> compartido entre el equipo de tracking (nosotros), el desarrollo del cliente y su
> infraestructura. No se escribió código todavía.

## 1. Objetivo

Hacer publicidad en Meta hacia un **bot de Telegram** de afiliación, midiendo dos
eventos para que el algoritmo optimice:

1. **Conversación iniciada** → evento Meta `Conversacion` (CAPI)
2. **Primer depósito** (cliente convertido) → evento Meta `Carga` (CAPI)

**Regla dura del cliente:** ningún servicio auditable (pixel de Meta, API de
WhatsApp, CRM) queda pegado al bot. El bot es una **caja negra** que solo recibe
usuarios. Toda la trazabilidad y el envío a Meta vive **aguas arriba**, en nuestra
capa intermedia. Meta nunca ve el bot ni el destino real.

## 2. Modelo de flujo

```
Anuncio Meta
   │  (pixel + CAPI acá, dominio NUESTRO, nombres de evento genéricos)
   ▼
NUESTRA landing de tracking  ──►  t.me/<bot>?start=<sub-id>  ──►  BOT (caja negra)
   │  capta fbclid → crea atribución (code = sub-id)                 │
   │                                                                 ▼
   │                                              Plataforma de afiliados del cliente
   │                                              (guarda el sub-id contra el usuario)
   │                                                                 │
   ◄──────── webhook por sub-id (canal aparte, server→server) ───────┘
   │  { conversation | first_deposit }
   ▼
NUESTRO servidor  ──►  CAPI a Meta (Conversacion / Carga)
```

El redirect al bot lo ejecuta **el navegador del usuario** (client-side), no un
servicio nuestro pegado al bot.

## 3. Glosario (hablar el mismo idioma)

| Término | Definición |
|---|---|
| **sub-id** | Identificador único por click/usuario que definimos NOSOTROS y viaja en `?start=`. Es nuestro `code` de atribución. |
| **code / token** | El mismo sub-id, como lo llamamos internamente en `attributions.code`. Formato `PB` + 6 chars (ej. `PBAB3K9X`). Ya es Telegram-safe. |
| **atribución** | Fila en la tabla `attributions` que guarda `code` + `fbclid`/`fbc`/`fbp`/`campaignId` capturados en la landing. |
| **conversation** | Evento del webhook: el usuario inició conversación con el bot → Meta `Conversacion`. |
| **first_deposit** | Evento del webhook: el usuario hizo su primer depósito → Meta `Carga`. |
| **caja negra** | El bot operativo. No lo instrumentamos ni le pega ningún servicio auditable. |
| **aguas arriba** | Todo lo que pasa antes del bot: landing, atribución, señales a Meta. Nuestro terreno. |

## 4. Qué se REUSA (ya existe en producción, 0 trabajo)

| Pieza | Archivo | Nota |
|---|---|---|
| Landing capta fbclid + dispara pixel | `app/l/[slug]/[landing]/page.tsx`, `app/l/_landing.tsx` | tal cual |
| Crea atribución con `code` + fbc/fbp/campaña | `app/api/track/redirect/route.ts`, tabla `attributions` | tal cual |
| Token ya Telegram-safe (`A-Z2-9`, 8 chars) | `lib/attribution.ts` → `generateCode()` | entra en `?start=` (máx 64, `A-Za-z0-9_-`) |
| Envío a Meta CAPI + dedup | `lib/meta.ts` → `sendCapiEvent()`, `eventExists()` | reuso directo |

## 5. Qué CONSTRUIMOS nosotros (lo único nuevo)

1. **Modo Telegram en la landing** — branch en `_landing.tsx` `go()`: si hay bot
   configurado, redirige a `t.me/<bot>?start=<code>`. Análogo a los branches
   existentes (`portalUrl`, `chatSlug`, `redirectUrl`). Config nueva: `telegramBot`.
   _(~medio día)_

2. **Webhook receptor** — `app/api/webhooks/affiliate/[slug]/route.ts`. Versión
   RECORTADA del webhook de Kommo: recibe el evento → busca la atribución por `code`
   → dispara `sendCapiEvent`. Sin Kommo, sin pipeline, sin CBU, sin upsert de lead.
   _(~1,5 días)_

3. **Config para enchufarlo** — flag de provider / campo de bot en la landing.
   _(~medio día)_

**Total dev nuestro: ~2-3 días.** El calendario a producción depende de la entrega
del cliente (sección 7) + testing conjunto → **1-2 semanas** en paralelo.

## 6. Contrato del webhook (lo que su infra debe construir)

**Nosotros exponemos** el endpoint; **ellos nos hacen POST** (server→server). No hay
ningún endpoint nuestro pegándole al bot.

- **URL:** `POST https://<nuestro-dominio>/api/webhooks/affiliate/<slug>`
- **Content-Type:** `application/json`
- **Auth:** header `X-Signature: <hex hmac-sha256(secret, rawBody)>`. `secret`
  compartido por cliente. (Alternativa simple: header `Authorization: Bearer <token>`.)
- **Body:**
  ```json
  {
    "sub_id": "PBAB3K9X",
    "event_type": "conversation",   // o "first_deposit"
    "user_id": "tg_123456789",       // id estable del usuario, para deduplicar
    "timestamp": "2026-08-27T14:05:00Z",
    "amount": 5000,                  // opcional, solo en first_deposit
    "currency": "ARS"               // opcional
  }
  ```
- **Respuestas nuestras:** `200 {ok:true}` procesado · `401` firma inválida ·
  `400` payload inválido · `5xx` error transitorio (que reintenten con backoff).
- **Idempotencia:** deduplicamos por `user_id` + `event_type`. Reenvíos = seguros.

### Mapeo a Meta

| `event_type` | Evento Meta | `event_id` (dedup) | Notas |
|---|---|---|---|
| `conversation` | `Conversacion` (→ `ConversacionCRM<suffix>`) | `conv-<user_id>` | |
| `first_deposit` | `Carga` (→ `CargoCRM<suffix>`) | `cargo-<user_id>` | `amount` → value de Meta |

El match `sub_id == attributions.code` nos da `fbc/fbp/fbclid/campaignId/eventSourceUrl`
para adjuntar al evento CAPI.

## 7. Qué provee el CLIENTE (los puentes)

Dirección importante: **ellos nos empujan el webhook** (no nos habilitan un endpoint
para que les peguemos — eso sería tocar el bot).

1. **Persistir el sub-id** (dev): cuando el usuario entra con `?start=<code>`, su
   plataforma guarda ese `code` contra el usuario y lo **devuelve** en el webhook.
   Hoy "solo acepta el código de referidor" → esto es la adaptación de su punto 1.
2. **Webhook saliente** (infra): POST a nuestra URL en los 2 momentos (sección 6).
3. **Secreto de auth** para firmar el webhook.
4. _(Opcional, reconciliación)_ endpoint read-only por sub-id para reconsultar si se
   pierde un evento. No bloqueante para v1.

## 8. Dependencias y preguntas abiertas

- [ ] ¿El sub-id es **único por click/usuario** (no un único código de afiliado)?
      Necesario para atribuir cada depósito a su fbclid.
- [ ] ¿El `user_id` es **estable** entre `conversation` y `first_deposit`? (dedup)
- [ ] ¿Mandan `amount` en `first_deposit`? (mejora la optimización por valor en Meta)
- [ ] ¿El webhook **reintenta** ante error? ¿timeout?
- [ ] "Conversación iniciada": ¿lo tienen como evento propio, o lo aproximamos con el
      click en la landing?

## 9. Principios que NO se rompen

- El bot es caja negra: nada auditable pegado a él.
- Pixel y CAPI viven en NUESTRO dominio/servidor, con nombres de evento genéricos.
- Meta nunca ve el bot ni el destino real.
- Toda automatización, aguas arriba, de nuestro lado.

# Integración afiliados Telegram — contrato de integración

> Estado: **implementado de nuestro lado, esperando OK del equipo del cliente.**
> Bot: `@candywinvip_bot`. Sin deploy todavía.
>
> Prerequisitos nuestros (no bloquean pedirles su parte): alta del tenant `candywin`
> con credenciales de Meta (Pixel + CAPI token + eventSuffix), correr la migración,
> crear la landing Telegram y generar el secreto.

## 1. Landing → bot

Mandamos al usuario a:

```
https://t.me/candywinvip_bot?start=<code>
```

El `<code>` es nuestro sub-id de atribución (formato `PBxxxxxx`, ej. `PBAB3K9X`).
Es único por click/usuario y es lo que nos permite atar la conversión a su fbclid/campaña.

## 2. Webhook (ustedes → nosotros, server→server)

```
POST https://<dominio>/api/webhooks/affiliate/<slug>
Content-Type: application/json
X-Signature: <hex hmac-sha256(secret, rawBody)>   # firma sobre el body CRUDO

{
  "lead_id": "PBAB3K9X",
  "event_type": "registro",              // o "carga"
  "timestamp": "2026-08-31T14:05:00Z"    // ISO 8601
}
```

- `lead_id`: el valor de `start` que recibió el bot, **devuelto verbatim**.
- `event_type`: `"registro"` (alta) o `"carga"` (depósito).
- `secret`: lo generamos **nosotros** y se los pasamos hecho. Firman con HMAC-SHA256 sobre el body exacto (bytes que envían).

> **Cargas:** manden **todas** las cargas con `event_type: "carga"`. De nuestro lado la
> métrica es la **primera carga por usuario**: la 1ª dispara el evento a Meta y las
> siguientes las recibimos con `200 {duplicate:true}` (no duplican). No tienen que
> filtrar nada ustedes.

## 3. Respuestas nuestras

| Código | Body | Significado |
|---|---|---|
| `200` | `{ok:true}` | procesado |
| `200` | `{ok:true, unmatched:true}` | `lead_id` sin match (no reintentar) |
| `200` | `{ok:true, duplicate:true}` | ya procesado (dedup) |
| `401` | | firma inválida |
| `400` | | payload inválido / `event_type` desconocido |
| `5xx` | | error transitorio → **reintentar con backoff** |

## 4. Dedup / idempotencia

Deduplicamos por `lead_id` + `event_type`. Reenvíos = seguros.

---

## 5. Qué necesitamos de su lado (pendiente)

1. **Persistir el `start`**: guardar el `<code>` que llega en `?start=` contra el usuario
   y devolverlo verbatim como `lead_id` en el webhook. (Hoy "solo aceptan el código de
   referidor" → esta es la adaptación.)
2. **Webhook saliente**: hacer el POST en los dos eventos: `registro` (alta) y `carga`
   (cada depósito). Firmado con HMAC-SHA256 (`X-Signature`), con el secreto que les damos.

> El secreto de auth lo generamos **nosotros** y se los pasamos hecho. No hay ninguna
> API nuestra que ustedes tengan que exponer: es una sola vía, ustedes nos POSTean.

## 6. Que nos confirmen (para cerrar)

- [ ] El `start` (`lead_id`) es **único por usuario** y lo devuelven **tal cual** lo mandamos.
- [ ] `registro`: con qué disparador exacto lo emiten (¿alta en su plataforma / primer `/start`?).
- [ ] `carga`: mandan **todas** las cargas con `event_type:"carga"` (nosotros medimos la 1ª).
- [ ] El webhook **reintenta** ante `5xx`/timeout (¿backoff y timeout?).
- [ ] Pueden firmar **HMAC-SHA256** sobre el **body crudo** con `Content-Type: application/json`.
- [ ] `timestamp` en ISO 8601 (UTC).

El `<slug>` final + el `secret` se los pasamos al activar. Dominio del webhook:
`https://tobyap-production.up.railway.app/api/webhooks/affiliate/<slug>`.

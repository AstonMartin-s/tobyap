# Integración afiliados Telegram — contrato de integración

> Estado: **listo y activo de nuestro lado.** Endpoint en producción, esperando
> que implementen el webhook saliente de su lado.
> Bot: `@candywinvip_bot`.

## 1. Flujo

```
Anuncio Meta → NUESTRA landing (capta fbclid + dispara pixel, genera <code>)
            → https://t.me/candywinvip_bot?start=<code>
            → el usuario usa el bot / su plataforma
            → su plataforma nos POSTea el webhook por <code>
            → nosotros disparamos el evento a Meta (CAPI)
```

El `<code>` es un sub-id único por click/usuario (afiliados Telegram → prefijo `TG`,
formato `TG` + 6 chars alfanuméricos en mayúsculas, largo fijo 8, ej. `TGAB3K9X`;
regex `TG[A-HJ-NP-Z2-9]{6}`, alfabeto sin I/O/0/1). Si lo separan de su cuenta con
guión bajo (`BMSHOP_TGAB3K9X`) también sirve: extraemos el `TGxxxxxx` por regex.
Es lo que nos permite atar cada conversión a su `fbclid`/campaña. **El bot es caja
negra: no le pegamos nada; toda la señal a Meta vive de nuestro lado.**

## 2. Webhook (ustedes → nosotros, server→server)

```
POST https://tobyap-production.up.railway.app/api/webhooks/affiliate/candywin
Content-Type: application/json
Authorization: Bearer <token>          # el secreto va ACÁ, en el header (no en la URL)

{
  "lead_id": "TGAB3K9X",                 // el valor de ?start= que recibió el bot, VERBATIM (o CUENTA_TGAB3K9X)
  "event_type": "registro",              // "registro" | "carga"
  "timestamp": "2026-08-31T14:05:00Z"    // ISO 8601 (UTC)
}
```

- **La URL NO lleva ningún secreto.** Es fija y pública (identifica al cliente por el
  slug `candywin`). El secreto viaja en el header `Authorization`. Lo que veían "en la
  URL" era solo el path del endpoint, nada sensible.
- `lead_id`: el `start` que recibió el bot, **devuelto tal cual** (es nuestro `<code>`).
- `event_type`:
  - `"registro"` → alta / conversación iniciada.
  - `"carga"` → depósito. **Manden TODAS las cargas.** Nosotros medimos la **primera**
    por usuario: la 1ª dispara el evento a Meta, las siguientes devuelven
    `200 {duplicate:true}` (no duplican). No tienen que filtrar nada.

## 3. Autenticación (elijan una — recomendamos Bearer token)

El endpoint acepta **cualquiera** de las dos. Con que valide una, alcanza. Ambas usan
el **mismo token/secreto** que les pasamos, así que si lo **rotan** (y nos avisan),
invalida las dos a la vez.

**Opción A — Bearer token (recomendada, la que propusieron)**
```
Authorization: Bearer <token>
```
Nosotros comparamos el token en tiempo constante contra el del cliente. Match → `200`.
No hay que firmar nada. (También aceptamos el token en el header `X-Webhook-Token` si
les resulta más cómodo.) **Este es el camino simple que pidieron: validan el 200 contra el token.**

**Opción B — Firma HMAC-SHA256 (alternativa, si prefieren firmar el body)**
```
X-Signature: <hex hmac-sha256(secret, rawBody)>   # hex pelado o con prefijo sha256=
```
Se firma **exactamente los bytes** del body (no un JSON re-serializado).

```js
// Node
const sig = require('crypto').createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
// header: X-Signature: sig
```

## 4. Respuestas

| Código | Body | Significado |
|---|---|---|
| `200` | `{ok:true}` | procesado (evento enviado a Meta) |
| `200` | `{ok:true, unmatched:true}` | `lead_id` sin match → **no reintentar** |
| `200` | `{ok:true, duplicate:true}` | ya procesado (dedup) → OK |
| `401` | `{error:"no autorizado"}` | token/firma inválidos o ausentes |
| `400` | `{error:...}` | payload inválido / `event_type` desconocido |
| `5xx` | | error transitorio → **reintentar con backoff** |

## 5. Idempotencia

Deduplicamos por `lead_id` + `event_type`. Reenvíos = seguros (nunca duplican en Meta).

## 6. Lo que necesitamos de su lado

1. **Persistir el `start`**: guardar el `<code>` que llega en `?start=` contra el usuario
   y devolverlo **verbatim** como `lead_id` en el webhook.
2. **Webhook saliente**: POST a la URL de arriba en los dos momentos (`registro` y `carga`),
   con el token en `Authorization: Bearer <token>` (o firma HMAC si eligen la opción B).
3. **Rotación**: si rotan el token, avísennos y lo actualizamos de nuestro lado.

## 7. Que nos confirmen (para cerrar)

- [ ] El `start` (`lead_id`) es **único por usuario** y lo devuelven **tal cual**.
- [ ] `registro`: con qué disparador exacto lo emiten (¿alta en su plataforma / primer `/start`?).
- [ ] `carga`: mandan **todas** las cargas con `event_type:"carga"`.
- [ ] El webhook **reintenta** ante `5xx`/timeout (¿backoff y timeout?).
- [ ] `timestamp` en ISO 8601 (UTC).
- [ ] Método de auth elegido (Bearer token recomendado) y quién genera el token
      (lo generamos nosotros y se los pasamos, o nos pasan el suyo — cualquiera sirve).

---

**Contacto técnico de nuestro lado:** para dudas de integración o para rotar el secreto,
escribirnos. El endpoint ya está activo y probado (podemos correr un test conjunto en
la pestaña *Test Events* de Meta cuando tengan el primer POST armado).

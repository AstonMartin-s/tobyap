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

El `<code>` es un sub-id único por click/usuario (formato `PBxxxxxx`, ej. `PBAB3K9X`).
Es lo que nos permite atar cada conversión a su `fbclid`/campaña. **El bot es caja
negra: no le pegamos nada; toda la señal a Meta vive de nuestro lado.**

## 2. Webhook (ustedes → nosotros, server→server)

```
POST https://tobyap-production.up.railway.app/api/webhooks/affiliate/candywin
Content-Type: application/json
X-Signature: <hex hmac-sha256(secret, rawBody)>     # firma sobre el body CRUDO

{
  "lead_id": "PBAB3K9X",                 // el valor de ?start= que recibió el bot, VERBATIM
  "event_type": "registro",              // "registro" | "carga"
  "timestamp": "2026-08-31T14:05:00Z"    // ISO 8601 (UTC)
}
```

- `lead_id`: el `start` que recibió el bot, **devuelto tal cual** (es nuestro `<code>`).
- `event_type`:
  - `"registro"` → alta / conversación iniciada.
  - `"carga"` → depósito. **Manden TODAS las cargas.** Nosotros medimos la **primera**
    por usuario: la 1ª dispara el evento a Meta, las siguientes devuelven
    `200 {duplicate:true}` (no duplican). No tienen que filtrar nada.
- `secret`: se los pasamos por canal seguro (link de un solo uso).

## 3. Firma (HMAC-SHA256 sobre el body crudo)

Se firma **exactamente los bytes** que envían en el body (no un JSON re-serializado).
El header puede ir como hex pelado o con prefijo `sha256=`.

**Node.js**
```js
const crypto = require('crypto');
const raw = JSON.stringify(payload);              // el MISMO string que mandan como body
const signature = crypto.createHmac('sha256', secret).update(raw, 'utf8').digest('hex');
// headers: { 'Content-Type': 'application/json', 'X-Signature': signature }
```

**Python**
```python
import hmac, hashlib, json
raw = json.dumps(payload, separators=(",", ":"))   # el MISMO string que mandan como body
signature = hmac.new(secret.encode(), raw.encode(), hashlib.sha256).hexdigest()
# headers: {"Content-Type": "application/json", "X-Signature": signature}
```

## 4. Respuestas

| Código | Body | Significado |
|---|---|---|
| `200` | `{ok:true}` | procesado (evento enviado a Meta) |
| `200` | `{ok:true, unmatched:true}` | `lead_id` sin match → **no reintentar** |
| `200` | `{ok:true, duplicate:true}` | ya procesado (dedup) → OK |
| `401` | `{error:"firma inválida"}` | firma HMAC incorrecta |
| `400` | `{error:...}` | payload inválido / `event_type` desconocido |
| `5xx` | | error transitorio → **reintentar con backoff** |

## 5. Idempotencia

Deduplicamos por `lead_id` + `event_type`. Reenvíos = seguros (nunca duplican en Meta).

## 6. Lo que necesitamos de su lado

1. **Persistir el `start`**: guardar el `<code>` que llega en `?start=` contra el usuario
   y devolverlo **verbatim** como `lead_id` en el webhook.
2. **Webhook saliente**: POST a la URL de arriba en los dos momentos (`registro` y `carga`),
   firmado con HMAC-SHA256 (`X-Signature`) usando el secreto que les pasamos.

## 7. Que nos confirmen (para cerrar)

- [ ] El `start` (`lead_id`) es **único por usuario** y lo devuelven **tal cual**.
- [ ] `registro`: con qué disparador exacto lo emiten (¿alta en su plataforma / primer `/start`?).
- [ ] `carga`: mandan **todas** las cargas con `event_type:"carga"`.
- [ ] El webhook **reintenta** ante `5xx`/timeout (¿backoff y timeout?).
- [ ] Firman **HMAC-SHA256** sobre el **body crudo**, `Content-Type: application/json`.
- [ ] `timestamp` en ISO 8601 (UTC).

---

**Contacto técnico de nuestro lado:** para dudas de integración o para rotar el secreto,
escribirnos. El endpoint ya está activo y probado (podemos correr un test conjunto en
la pestaña *Test Events* de Meta cuando tengan el primer POST armado).

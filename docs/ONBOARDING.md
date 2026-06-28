# Alta de un cliente nuevo — qué necesito y cómo

## 1. Lo que tenés que conseguir del cliente (datos)

| Dato | De dónde sale | Obligatorio |
|---|---|---|
| **Subdominio Kommo** | `<subdominio>.kommo.com` | ✅ |
| **Token largo de Kommo** | Kommo → Ajustes → Integraciones → (integración) → Llaves y alcances → "Generar token de larga duración" | ✅ |
| **Pixel ID de Meta** | Events Manager del cliente | ✅ |
| **Token CAPI de Meta** | Events Manager → dataset → Configuración → Conversions API | ✅ |
| **Usuario panel** (email del cliente) | lo definís vos | ✅ |
| **Contraseña panel** | la definís vos | ✅ |
| **event_suffix** (nº único) | lo asignás vos, único por cliente (ej. 3, 4, 5…) | ✅ |
| Email/clave de login Kommo | referencia operativa | opcional |
| OpenAI key | solo si se usa IA | opcional |

> El **event_suffix** evita pisar conversiones entre clientes/CRMs en Meta:
> `ConversacionCRM<suffix>` / `CargoCRM<suffix>`.

## 2. Armás el JSON del cliente (`tenants/<slug>.json`, NO se commitea)

```json
{
  "slug": "nuevocliente",
  "name": "Nuevo Cliente",
  "role": "client",
  "kommoSubdomain": "nuevocliente",
  "kommoToken": "<token largo kommo>",
  "panelUser": "nuevocliente@gmail.com",
  "panelPassword": "<pass panel>",
  "metaPixelId": "<pixel>",
  "metaCapiToken": "<token capi>",
  "eventSuffix": "3",
  "settings": { "accountName": "Titular CBU", "accountCbu": "0000..." }
}
```
Opcionales: `pipelineName` (si no es "Embudo de ventas"), `bonoMap` (override CCPP→bono),
`customFields` (override de IDs), `apiUrl`/`externalApiKey` (solo si importás histórico).

## 3. Provisionás (1 comando)

```bash
npm run provision -- tenants/nuevocliente.json
```
Esto, contra el Kommo del cliente:
1. **Crea el embudo base** (Embudo de ventas: Revisar → Pidio Usuario → Pidio CbuAlias
   → Revisar imagen → **Cargo$** → No Atender → No Cargo → Seguimiento).
2. **Crea los custom fields** que falten: `fbclid, utm_campaign, utm_source, utm_content,
   CBU, TITULAR`.
3. **Descubre** los IDs por nombre y **crea el tenant** en TOBYAP.

> Si el cliente ya tiene el embudo armado, usá `npm run onboard` en vez de `provision`
> (solo descubre y da de alta, no crea nada).

## 4. Configurás en el Kommo del cliente (manual — la API de Kommo no crea bots)

**Webhook** (Ajustes → Webhooks → nueva URL):
- `https://tobyap-production.up.railway.app/api/webhooks/kommo/<slug>`
- Triggers: **Lead agregado**, **El estado del lead cambia**, **Mensaje entrante recibido**.

**Salesbots** (Salesbot designer — importar los del modelo en `Bots Kommo/`):
| Bot | Acción a configurar |
|---|---|
| WELCOME | mensaje de bienvenida + botón |
| CARGO | `send_hook` → `…/api/conversion-event/<slug>` (dispara la carga) |
| CBU | `send_hook` → `…/api/cbu/<slug>` + mensaje con `{{lead.cf.<CBU>}}` / `{{lead.cf.<TITULAR>}}` |
| REVISAR_IMAGEN | mueve a "Revisar imagen" |
| CREO_USUARIO / SEGUIMIENTO | mensajes/estados |

> Los bots no se crean por API; se importan a mano en el diseñador y se les apunta el
> `send_hook` a nuestros endpoints. (Automatizar esto es una fase futura aparte.)

## 5. Landing del cliente

La landing propia ya está servida por la app:
```
https://tobyap-production.up.railway.app/l/<slug>?campaign=CC1&CCPP=A1
   + (de Meta) &utm_source={{campaign.id}}&utm_campaign={{campaign.name}}
              &utm_content={{ad.id}}&namead={{ad.name}}
```
Genera el token, guarda la atribución y redirige a WhatsApp con el mensaje.
El número de publicidad sale del panel (Números, tipo `publi`).

## 6. Listo
- Conversaciones, cargas, redirects y atribución (etiquetas campaña+bono, fbclid/utm)
  fluyen a la DB y a Meta, separados por `event_suffix`.
- El cliente entra al panel con su email; vos ves todo en `/admin`.

---

### Resumen ultra-corto
1. Conseguir: subdominio + token Kommo, pixel + token CAPI Meta, suffix único, user/pass panel.
2. `npm run provision -- tenants/<slug>.json`
3. En Kommo: pegar webhook (3 triggers) + importar bots con los send_hook a nuestros endpoints.
4. Usar la landing `/l/<slug>` en los anuncios.

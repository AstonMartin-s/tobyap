# Plan — Panel de operaciones (saldo real) para bblack / Partner API

Fecha: 2026-08-20
Estado: **plan aprobado para armar, NADA en producción todavía.**

Objetivo: contenedor lateral desplegable a la derecha del chat (en `/chats`) que
deje al operario **consultar saldo, cargar y retirar fichas reales** vía la
Partner API de KingPlay, sin romper nada del flujo actual ni del cliente King.

---

## Verificado hoy (funciona contra la API real)

- ✅ `deposit` — cargó $500 a `TestTOBYAP909` (visible en el panel de KingPlay).
- ✅ `withdraw` — retiró $500, saldo volvió a $0.
- ✅ Idempotencia por `reference` (regla de oro del manual: misma reference = no
  duplica; ante timeout se reintenta con la MISMA, nunca una nueva).

---

## Qué requerimos (relevamiento)

### 1. Capa API — `lib/partner-api.ts`
- Ya tiene: `deposit`, `getPlayer` (saldo), `createPlayer`, `playerSession`, `getConfig`.
- **Falta: `withdraw`** (idéntico a `deposit`, endpoint `/players/{user}/withdraw`).

### 2. Registro de operaciones — tabla nueva `partner_operations`
Necesaria por DOS motivos:
- **Idempotencia**: guardamos la `reference` de cada carga/retiro. Un doble-click o
  un reintento por timeout reusa la misma reference → nunca carga dos veces.
- **"Balance Total" del panel** (Total Cargado / Total Retirado / Balance): la
  Partner API NO devuelve ese acumulado — lo llevamos nosotros sumando nuestras
  operaciones.

Columnas: `id, tenantId, sessionId?, username, type (deposit|withdraw), amount,
reference (unique), ledgerId, balanceAfter, operator, status, createdAt`.

### 3. Ops nuevas en el panel — `app/api/panel/chats/route.ts`
- `pa_balance` — consulta saldo (`getPlayer`). **Solo lectura, sin riesgo.**
- `pa_deposit` — carga real. Requiere confirmación del operario.
- `pa_withdraw` — retiro real. Requiere confirmación del operario.

Todas **gateadas por `tenant.provider === 'partner_api'`** → King (pagoda) no las ve
ni las puede llamar. Requieren que la sesión tenga `data.username`.

### 4. UI — contenedor lateral `Panel de operaciones`
Componente nuevo **autocontenido** `app/chats/OperationsPanel.tsx`, montado en el
panel de detalle con 1 línea en `ChatsClient.tsx` (huella mínima). Muestra:
- **Saldo actual** + botón "Consultar saldo".
- **Balance total** (Cargado / Retirado / Balance) desde `partner_operations`.
- **Acciones rápidas**: Cargar / Retirar (con monto + botones +100/+500/+1000/+5000).
- Selector de bono (la API soporta bono pegado al depósito; rollover está apagado
  en bblack, así que bono % simple).
- Solo se renderiza si el tenant es `partner_api` → invisible para King.

---

## Seguridad del movimiento de plata (clave)

1. **Lo dispara SIEMPRE un humano** tocando "Cargar"/"Retirar" — igual que hoy el
   operario aprueba un comprobante. El sistema nunca mueve plata solo.
2. **Diálogo de confirmación** antes de ejecutar: muestra usuario + monto + tipo.
3. **Idempotencia**: la `reference` se deriva del `id` de la fila `partner_operations`
   (se crea la fila primero, después se llama la API con esa reference). Un
   doble-click no duplica.
4. **Registro y trazabilidad**: cada operación queda con operador + timestamp + nota
   en Kommo (rastro).
5. **Mensaje al cliente opcional**: al cargar, se puede postear en el chat
   "Recibimos tu pago de $X, ya está acreditado" — vía `appendChatMessages`
   (contrato R1, escritura atómica).

---

## Orden de implementación (prolijo, sin romper)

1. `withdraw` en `partner-api.ts` (local, inocuo).
2. Tabla `partner_operations` + migración idempotente (`CREATE TABLE IF NOT EXISTS`).
3. `lib/partner-ops.ts` — helper que envuelve deposit/withdraw con: crear fila →
   llamar API con reference → registrar ledgerId/balance. Idempotente.
4. Ops `pa_balance` / `pa_deposit` / `pa_withdraw` en `panel/chats` (gateadas por provider).
5. Componente `OperationsPanel.tsx` + 1 línea de montaje en `ChatsClient.tsx`.
6. Typecheck + build + prueba en dev contra la API real (monto chico).
7. **Recién ahí**: deploy y confirmación.

---

## Coordinación con Cursor (R1 obligatorio antes de tocar)

`ChatsClient.tsx` y `panel/chats/route.ts` están bajo el contrato de Cursor:
- Escrituras a `chat_sessions` → **por `mutations.ts`** (ya lo respetamos).
- Enviar R1 antes de editar esos dos archivos, avisando: op nuevas `pa_*`,
  montaje del `OperationsPanel`, tabla `partner_operations`.

---

## Decisiones tomadas (2026-08-20)

1. **Tope por operación**: SÍ, configurable (máximo por carga). Evita error de tipeo caro.
2. **Bono**: **automático según la promo activa del cliente**, pero con un
   **desplegable editable** para que el operario lo cambie si hace falta.
3. **Permisos**: cualquier operario con acceso al panel (sin roles finos por ahora;
   se trabajará más adelante).
4. **Retiro**: en bblack rollover está apagado → sin restricción extra hoy.

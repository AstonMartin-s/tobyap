import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { db } from '@/db';
import { chatSessions } from '@/db/schema';
import { getSession, isPanelAdmin } from '@/lib/session';
import { getTenantBySlug } from '@/lib/tenants';
import { phoneForExport } from '@/lib/phone';
import { addLeadNote } from '@/lib/chat/kommoMirror';
import { updateLeadStatus, deleteKommoLead } from '@/lib/kommo';
import { kommoStatusFromPanelStep, acreditarChat } from '@/lib/chat/release';
import { purgeChatSession } from '@/lib/chat/deleteSession';
import { trimBandeja } from '@/lib/chat/bandeja';
import { appendChatMessages, mergeChatData } from '@/lib/chat/mutations';
import { sendPushToSession } from '@/lib/chat/push';
import { loadChatRuntime } from '@/lib/chat/loadRuntime';
import { emitCargo, panelApproveEmitsCargo } from '@/lib/cargo/emit';
import { depositOp, withdrawOp, consultBalance, operationsSummary } from '@/lib/partner-ops';
import { kingDepositOp, kingWithdrawOp, kingConsultBalance } from '@/lib/king-ops';
import {
  comprobantePendingMessages,
  comprobanteRejectedMessages,
  supportMessage,
  postActionMessages,
} from '@/lib/chat/flow';
import { prepareBotBatch } from '@/lib/chat/stagger';
import { listCajeros } from '@/lib/rotation';

export const dynamic = 'force-dynamic';

type Msg = { from: 'bot' | 'user'; text?: string; image?: string; at: number; op?: boolean };

// GET /api/panel/chats  → lista de sesiones del tenant logueado (panel operador).
// Por defecto devuelve las 200 más recientes (Inbox de trabajo). Las pestañas
// terminales (Acreditados / No cargó / Archivadas) son estados viejos que caen
// fuera de esas 200, así que se piden aparte con ?view= para que la lista no
// quede vacía aunque el contador (calculado sobre toda la base) diga que hay.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no autorizado' }, { status: 401 });

  const view = new URL(req.url).searchParams.get('view');
  const base = eq(chatSessions.tenantId, session.tenantId);
  let where = base;
  let limit = 200;

  // Bandeja Inbox: auto-archivar chats en curso que exceden el tope (cargo/no cargo/revisar exentos).
  if (!view) await trimBandeja(session.tenantId);

  if (view === 'done' || view === 'no_cargo') {
    where = and(base, eq(chatSessions.step, view))!;
    limit = 500;
  } else if (view === 'archived') {
    where = and(base, sql`(${chatSessions.data} ->> 'archived') = 'true'`)!;
    limit = 500;
  }

  // Columnas de la lista: NO traemos el `data` completo (guarda el comprobante en
  // base64, que pesa MBs por fila) — lo servimos por /file y en el detalle. Quitamos
  // solo la clave `comprobante` del JSONB; el resto de `data` (username, flags, etc.)
  // queda intacto. Baja fuerte el egress DB→app en cada refresh del panel.
  const listCols = {
    id: chatSessions.id,
    sessionKey: chatSessions.sessionKey,
    phone: chatSessions.phone,
    name: chatSessions.name,
    waVerified: chatSessions.waVerified,
    campaign: chatSessions.campaign,
    step: chatSessions.step,
    kommoLeadId: chatSessions.kommoLeadId,
    messages: chatSessions.messages,
    data: sql<Record<string, unknown>>`${chatSessions.data} - 'comprobante' - 'comprobantes'`,
    createdAt: chatSessions.createdAt,
    updatedAt: chatSessions.updatedAt,
  } as const;

  const rows = await db
    .select(listCols)
    .from(chatSessions)
    .where(where)
    .orderBy(desc(chatSessions.updatedAt))
    .limit(limit);

  // Archivados que todavía requieren atención (revisar / no leídos) — no deben
  // perderse de la bandeja aunque el trim los haya archivado por antigüedad.
  let extraRows: typeof rows = [];
  if (!view) {
    extraRows = await db
      .select(listCols)
      .from(chatSessions)
      .where(
        and(
          base,
          sql`(${chatSessions.data} ->> 'archived') = 'true'`,
          sql`(
            (${chatSessions.data} ->> 'unread') = 'true'
            OR ${chatSessions.step} = 'validando'
          )`,
        ),
      )
      .orderBy(desc(chatSessions.updatedAt))
      .limit(50);
  }

  const merged = new Map<string, typeof rows[number]>();
  for (const s of rows) merged.set(s.sessionKey, s);
  for (const s of extraRows) merged.set(s.sessionKey, s);
  const allRows = [...merged.values()].sort(
    (a, b) => new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime(),
  );

  // Stats sobre TODA la base (solo step + fecha, liviano) para que los KPIs no
  // queden capados por el límite de 200 de la lista. Excluye campaña Test (testeo).
  const statRowsRaw = await db
    .select({ step: chatSessions.step, createdAt: chatSessions.createdAt, campaign: chatSessions.campaign })
    .from(chatSessions)
    .where(eq(chatSessions.tenantId, session.tenantId));
  const statRows = statRowsRaw.filter((s) => (s.campaign ?? '').toLowerCase() !== 'test');

  const items = allRows.map((s) => {
    const msgs = (s.messages ?? []) as Msg[];
    const sdata = (s.data ?? {}) as Record<string, unknown>;
    const username = sdata.username as string | undefined;
    // Si está sin leer, la vista previa muestra el mensaje del CLIENTE que lo
    // generó (no un recontacto/autoreply saliente posterior) — así se entiende
    // por qué está pendiente en vez de mostrar nuestro propio mensaje de salida.
    let last = msgs[msgs.length - 1];
    if (sdata.unread === true) {
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].from === 'user') { last = msgs[i]; break; }
      }
    }
    const lastMsg = msgs[msgs.length - 1];
    const lastAtMs = lastMsg?.at;
    const lastAt = lastAtMs
      ? new Date(lastAtMs < 1e12 ? lastAtMs * 1000 : lastAtMs).toISOString()
      : s.updatedAt ? new Date(s.updatedAt).toISOString() : null;
    return {
      sessionKey: s.sessionKey,
      phone: s.phone,
      name: s.name,
      username: username ?? null, // usuario del portal (ej. camilo787) — búscable
      archived: sdata.archived === true,
      unread: sdata.unread === true,
      unreadCount: typeof sdata.unreadCount === 'number' && sdata.unreadCount > 0
        ? sdata.unreadCount
        : (sdata.unread === true ? 1 : 0),
      blocked: sdata.blocked === true,
      step: s.step,
      kommoLeadId: s.kommoLeadId,
      campaign: s.campaign,
      waVerified: s.waVerified,
      hasComprobante: msgs.some((m) => m.from === 'user' && m.image),
      msgCount: msgs.length,
      lastText: last?.text ?? (last?.image ? '📷 imagen' : ''),
      lastFrom: last?.from ?? null,
      lastAt,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    };
  });

  const tenantForProvider = await getTenantBySlug(session.slug);

  return NextResponse.json({
    ok: true,
    items,
    stats: statRows,
    tenantProvider: tenantForProvider?.provider ?? 'pagoda',
    fichasEnabled: tenantForProvider ? tenantForProvider.features.fichas : true,
  });
}

// GET individual (transcript) via ?sessionKey=... handled in GET? Keep simple:
// el detalle se pide con POST op:'get'. Pero para no complicar, exponemos detalle
// por query en un segundo GET no; usamos POST abajo.

// POST /api/panel/chats  { sessionKey, op, text? }
// Ejecuta una acción manual del operador que se ENTREGA en el chat del cliente
// (se inyecta en la sesión; el widget la levanta en su próximo poll).
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no autorizado' }, { status: 401 });

  const b = (await req.json().catch(() => ({}))) as {
    sessionKey?: string;
    op?: string;
    text?: string;
    step?: string;
    from?: string;
    to?: string;
    steps?: string[];
    deleteChat?: boolean;
    deleteLead?: boolean;
    amount?: number;
    bonusPercent?: number;
  };

  // Export CSV flexible: rango de creación + filtro opcional por estado. Para cruzar
  // con bases externas (no solo step=done en TrackerIO).
  if (b.op === 'export_csv' || b.op === 'export_done') {
    // Regla principal: exportar es exclusivo de admin.
    if (!isPanelAdmin(session.panelRole)) {
      return NextResponse.json({ error: 'solo un admin puede exportar' }, { status: 403 });
    }
    let where = eq(chatSessions.tenantId, session.tenantId);
    // Legacy export_done = solo acreditados, sin filtro de fecha.
    if (b.op === 'export_done') {
      where = and(where, eq(chatSessions.step, 'done'))!;
    } else {
      if (b.from) where = and(where, gte(chatSessions.createdAt, new Date(`${b.from}T00:00:00`)))!;
      if (b.to) where = and(where, lte(chatSessions.createdAt, new Date(`${b.to}T23:59:59.999`)))!;
      const steps = (b.steps ?? []).filter(Boolean);
      if (steps.length) where = and(where, inArray(chatSessions.step, steps))!;
    }
    const STEP_LABEL: Record<string, string> = {
      form: 'Formulario', welcome: 'Pidió Usuario', credenciales: 'Usuario Creado',
      cbu: 'Pidió CBU', comprobante: 'Pidió CBU', app_onboarding: 'Instalando app',
      validando: 'Revisar imagen', done: 'Cargo$', no_cargo: 'No Cargo', closed: 'Cerrado',
    };
    // Solo columnas usadas por el CSV (sin messages/data pesados): username sale del
    // JSONB con ->> para no traer todo el blob por cada una de las hasta 10k filas.
    const rows = await db
      .select({
        name: chatSessions.name,
        username: sql<string | null>`${chatSessions.data} ->> 'username'`,
        phone: chatSessions.phone,
        step: chatSessions.step,
        campaign: chatSessions.campaign,
        ccpp: chatSessions.ccpp,
        createdAt: chatSessions.createdAt,
        updatedAt: chatSessions.updatedAt,
        kommoLeadId: chatSessions.kommoLeadId,
      })
      .from(chatSessions)
      .where(where)
      .orderBy(desc(chatSessions.createdAt))
      .limit(10000);
    const data = rows.map((s) => {
      const st = s.step ?? '';
      return {
        nombre: s.name ?? '',
        usuario: s.username ?? '',
        telefono: phoneForExport(s.phone),
        estado: STEP_LABEL[st] ?? st,
        campana: s.campaign ?? '',
        ccpp: s.ccpp ?? '',
        creado: s.createdAt ? new Date(s.createdAt).toISOString() : '',
        actualizado: s.updatedAt ? new Date(s.updatedAt).toISOString() : '',
        kommo: s.kommoLeadId ?? '',
      };
    });
    return NextResponse.json({ ok: true, rows: data, truncated: rows.length >= 10000 });
  }

  if (!b.sessionKey || !b.op) return NextResponse.json({ error: 'sessionKey y op requeridos' }, { status: 400 });

  const [s] = await db
    .select()
    .from(chatSessions)
    .where(and(eq(chatSessions.tenantId, session.tenantId), eq(chatSessions.sessionKey, b.sessionKey)));
  if (!s) return NextResponse.json({ error: 'sesión desconocida' }, { status: 404 });

  const data = (s.data ?? {}) as Record<string, unknown>;
  const loginUrl = data.loginUrl as string | undefined;

  // ── Cajero sticky ──────────────────────────────────────────────────────────
  // Lista de cajeros disponibles + el asignado actual (para la solapa del lead).
  if (b.op === 'cajeros_list') {
    const list = await listCajeros(session.tenantId);
    return NextResponse.json({
      ok: true,
      cajeros: list,
      assignedWa: (data.assignedWa as string | null) ?? null,
      assignedWaName: (data.assignedWaName as string | null) ?? null,
    });
  }
  // Reasignación manual del cajero. Acepta un phone del pool (b.to) o vacío para
  // desasignar. Guardamos también el nombre para mostrarlo en el panel.
  if (b.op === 'assign_cajero') {
    const toDigits = (b.to ?? '').replace(/\D/g, '');
    if (!toDigits) {
      await mergeChatData(s.id, { assignedWa: null, assignedWaName: null }, undefined, { touchUpdatedAt: false });
      return NextResponse.json({ ok: true, assignedWa: null, assignedWaName: null });
    }
    const list = await listCajeros(session.tenantId);
    const match = list.find((c) => c.phone.replace(/\D/g, '') === toDigits);
    if (!match) return NextResponse.json({ error: 'cajero no está en el pool' }, { status: 400 });
    await mergeChatData(s.id, { assignedWa: match.phone, assignedWaName: match.name ?? null }, undefined, { touchUpdatedAt: false });
    return NextResponse.json({ ok: true, assignedWa: match.phone, assignedWaName: match.name ?? null });
  }

  // ── Operaciones de SALDO REAL (Partner API / King API) ─────────────────────
  // Provider 'partner_api' (bblack) o 'king' (greenbet/dat4win). El disparo lo
  // hace SIEMPRE el operario (botón); nunca automático.
  if (b.op === 'pa_balance' || b.op === 'pa_deposit' || b.op === 'pa_withdraw') {
    const tenant = await getTenantBySlug(session.slug);
    if (!tenant || (tenant.provider !== 'partner_api' && tenant.provider !== 'king')) {
      return NextResponse.json({ ok: false, skip: true, error: 'cliente sin API de fichas' });
    }
    if (!tenant.features.fichas) {
      return NextResponse.json({ ok: false, skip: true, error: 'función de fichas deshabilitada para este cliente' });
    }
    const username = data.username as string | undefined;
    if (!username) return NextResponse.json({ ok: false, error: 'la sesión no tiene usuario de portal' }, { status: 400 });

    if (b.op === 'pa_balance') {
      const isKing = tenant.provider === 'king';
      const [bal, summary] = await Promise.all([
        isKing ? kingConsultBalance(tenant, username) : consultBalance(tenant, username),
        operationsSummary(tenant, username),
      ]);
      return NextResponse.json({ ok: bal.ok, balance: bal.balance, error: bal.error, summary });
    }

    // Carga / retiro: bono automático desde la promo (offerValue), overridable.
    const runtime = await loadChatRuntime(session.tenantId, session.slug, s.phone);
    const promoBonus = runtime.offerType === 'bonus' ? runtime.offerValue : 0;
    const bonusPercent = b.op === 'pa_deposit'
      ? (b.bonusPercent != null ? b.bonusPercent : promoBonus)
      : undefined;

    const opArgs = { username, amount: b.amount ?? 0, operator: session.slug, sessionId: s.id, bonusPercent };
    const res = tenant.provider === 'king'
      ? (b.op === 'pa_deposit'
          ? await kingDepositOp(tenant, opArgs)
          : await kingWithdrawOp(tenant, opArgs))
      : (b.op === 'pa_deposit'
          ? await depositOp(tenant, opArgs)
          : await withdrawOp(tenant, opArgs));

    if (res.ok) {
      const montoTxt = `$${(b.amount ?? 0).toLocaleString('es-AR')}`;
      if (s.kommoLeadId) {
        addLeadNote(tenant, s.kommoLeadId, `💰 ${res.type === 'deposit' ? 'CARGA' : 'RETIRO'} ${montoTxt} vía panel (${session.slug}). Saldo: $${res.balance}.`);
      }

      if (res.type === 'deposit') {
        // CARGAR = ACREDITAR: misma función que "Aprobar". Acredita el chat (mensaje
        // estándar + candado atómico), mueve el lead a Cargo$ y dispara CargoCRM a
        // Meta. Todo idempotente: si ya se aprobó/cargó antes, no duplica.
        await acreditarChat(tenant, { sessionKey: s.sessionKey });
        if (s.kommoLeadId && tenant.statusCargoId) {
          updateLeadStatus(tenant, s.kommoLeadId, tenant.statusCargoId).catch(() => {});
        }
        if (panelApproveEmitsCargo()) {
          await emitCargo(tenant, {
            kommoLeadId: s.kommoLeadId,
            sessionKey: s.sessionKey,
            source: 'panel',
            operator: session.slug,
            // Valor real cargado (ARS) → Meta puede optimizar campañas por valor
            // de Cargo, no solo por conversación. Solo si el monto es > 0.
            value: b.amount && b.amount > 0 ? b.amount : undefined,
            currency: 'ARS',
            skipKommoStatus: true,
            skipChatRelease: true,
          }).catch((e) => console.error(`[panel/chats ${session.slug}] emitCargo (pa_deposit):`, e));
        }
        void sendPushToSession(s.id, data.pushSub, {
          title: '¡Fichas acreditadas!',
          body: `Te acreditamos ${montoTxt}. ¡A jugar!`,
          url: `/chat/${session.slug}`,
        });
      } else {
        // Retiro: solo mensaje informativo (no es una acreditación).
        await appendChatMessages(s.id, [{ from: 'bot', text: `✅ Procesamos tu retiro de ${montoTxt}.`, at: Date.now(), op: true }]);
        void sendPushToSession(s.id, data.pushSub, { title: 'Retiro procesado', body: `Procesamos tu retiro de ${montoTxt}.`, url: `/chat/${session.slug}` });
      }
    }
    return NextResponse.json(res);
  }

  // Archivar / desarchivar (flag en data, NO toca el estado del embudo). El chat
  // vuelve solo a la bandeja cuando el cliente escribe (ver /message y /upload).
  if (b.op === 'archive' || b.op === 'unarchive') {
    const archived = b.op === 'archive';
    await mergeChatData(s.id, { archived });
    return NextResponse.json({ ok: true, archived });
  }

  // Marcar no leído a mano (para volver después). Leer se hace solo al abrir.
  if (b.op === 'mark_unread') {
    await mergeChatData(s.id, { unread: true, unreadCount: 1 });
    return NextResponse.json({ ok: true, unread: true });
  }

  if (b.op === 'mark_revisar') {
    await db.update(chatSessions).set({ step: 'validando', updatedAt: new Date() }).where(eq(chatSessions.id, s.id));
    await mergeChatData(s.id, { unread: true, unreadCount: 1, archived: false });
    const tenant = await getTenantBySlug(session.slug);
    if (tenant && s.kommoLeadId) {
      addLeadNote(tenant, s.kommoLeadId, 'Supervisor: marcado para revisar desde el panel TrackerIO.');
      const kstatus = kommoStatusFromPanelStep(tenant, 'validando');
      if (kstatus) updateLeadStatus(tenant, s.kommoLeadId, kstatus).catch(() => {});
    }
    return NextResponse.json({ ok: true, step: 'validando' });
  }

  if (b.op === 'delete') {
    const deleteLead = b.deleteLead === true;
    const deleteChat = b.deleteChat === true || deleteLead;
    if (!deleteChat) return NextResponse.json({ error: 'confirmá qué querés borrar' }, { status: 400 });
    const tenant = await getTenantBySlug(session.slug);
    let leadDeleted = false;
    if (deleteLead && s.kommoLeadId && tenant) {
      leadDeleted = await deleteKommoLead(tenant, s.kommoLeadId);
    }
    await purgeChatSession(s.id, data);
    return NextResponse.json({ ok: true, deletedChat: true, deletedLead: leadDeleted });
  }

  // Bloquear / desbloquear: un bloqueado no puede seguir en el chat (start/message/
  // upload lo rechazan). Además lo archivamos para sacarlo de la bandeja.
  if (b.op === 'block' || b.op === 'unblock') {
    const blocked = b.op === 'block';
    await mergeChatData(s.id, { blocked, ...(blocked ? { archived: true, unread: false, unreadCount: 0 } : {}) });
    return NextResponse.json({ ok: true, blocked });
  }

  // Detalle: devuelve el transcript completo (para abrir la conversación). Quitamos
  // el comprobante en base64 de `data` — pesa MBs y la imagen ya se sirve por /file;
  // bajarlo en cada refresh del panel es puro desperdicio de banda.
  if (b.op === 'get') {
    const full = (s.data ?? {}) as Record<string, unknown>;
    // Abrir el chat = leerlo → limpia el "no leído" (best-effort, sin bloquear).
    if (full.unread) mergeChatData(s.id, { unread: false, unreadCount: 0 }, undefined, { touchUpdatedAt: false }).catch(() => {});
    // El panel muestra las imágenes vía las URLs de cada mensaje (`/file?c=...`),
    // no desde `data` — así que quitamos el/los base64 pesados del detalle.
    const { comprobante, comprobantes, ...dataLite } = full;
    void comprobante; void comprobantes;
    return NextResponse.json({ ok: true, session: { ...s, data: dataLite } });
  }

  const runtime = await loadChatRuntime(session.tenantId, session.slug, s.phone);

  let newMsgs: Msg[] = [];
  let newStep: string | undefined;
  let note: string | null = null;
  // Cuando el operador escribe un mensaje libre, "toma" la conversación: a partir
  // de ahí el bot deja de mandar los recordatorios automáticos por paso (ej.
  // "mandame el comprobante"), para no pisar la charla humana en curso.
  let operatorTookOver = false;

  switch (b.op) {
    case 'approve':
      // El mensaje de acreditación NO se agrega acá: lo hace acreditarChat abajo,
      // con candado atómico, para no duplicar si el webhook/poll también disparan.
      note = '✅ Comprobante APROBADO manualmente desde el panel (ficha entregada en el chat).';
      break;
    case 'pending':
      newMsgs = prepareBotBatch(comprobantePendingMessages(runtime), { op: true });
      note = '⏳ Comprobante marcado PENDIENTE desde el panel.';
      break;
    case 'reject':
      newMsgs = prepareBotBatch(comprobanteRejectedMessages(runtime), { op: true });
      newStep = 'comprobante';
      note = '⚠️ Comprobante RECHAZADO desde el panel (se le pidió reenviar).';
      break;
    case 'support':
      newMsgs = prepareBotBatch(supportMessage(runtime, data), { op: true });
      note = '🙋 Se le pasó el WhatsApp del cajero asignado (o soporte) desde el panel.';
      break;
    case 'deposit':
    case 'withdraw':
    case 'forgot_user': {
      const r = postActionMessages(b.op, data, runtime);
      newMsgs = prepareBotBatch(r.messages, { op: true });
      break;
    }
    case 'custom': {
      const t = (b.text ?? '').trim();
      if (!t) return NextResponse.json({ error: 'texto vacío' }, { status: 400 });
      newMsgs = [{ from: 'bot', text: t, at: Date.now(), op: true }];
      note = `✍️ Mensaje manual del operador: "${t.slice(0, 120)}"`;
      operatorTookOver = true;
      break;
    }
    // Cambio de estado manual (dropdown estilo Kommo) — NO manda mensaje al cliente,
    // sólo mueve el estado de la conversación en el panel.
    case 'set_step': {
      const ALLOWED = ['form', 'welcome', 'credenciales', 'cbu', 'comprobante', 'app_onboarding', 'validando', 'done', 'no_cargo', 'closed'];
      const st = b.step ?? '';
      if (!ALLOWED.includes(st)) return NextResponse.json({ error: 'estado inválido' }, { status: 400 });
      newStep = st;
      note = `🔀 Estado cambiado manualmente a "${st}" desde el panel.`;
      break;
    }
    default:
      return NextResponse.json({ error: 'op desconocida' }, { status: 400 });
  }

  // Marcamos como del OPERADOR (op:true) todo lo que se dispara desde el panel,
  // para distinguirlo de los mensajes automáticos (BOT) en la vista. Append atómico
  // para no pisar mensajes que entren en paralelo (otro operario / supervisor / poll).
  const opMsgs = newMsgs;
  const opAppend: { step?: string; dataMerge?: Record<string, unknown> } = {};
  if (newStep) opAppend.step = newStep;
  if (operatorTookOver) opAppend.dataMerge = { operatorTookOver: true };
  await appendChatMessages(s.id, opMsgs, opAppend);

  // Web Push (best-effort): si el cliente habilitó notificaciones, le avisamos del
  // mensaje del operador aunque tenga el chat cerrado. No aplica a 'approve' (ese
  // agrega su mensaje aparte, más abajo). No bloquea la respuesta.
  const lastOut = opMsgs[opMsgs.length - 1];
  if (lastOut?.text) {
    void sendPushToSession(s.id, data.pushSub, {
      title: 'Tenés un mensaje nuevo',
      body: lastOut.text.slice(0, 120),
      url: `/chat/${session.slug}`,
    });
  }

  // Espejo a Kommo (best-effort). BIDIRECCIONAL: si el operador cambió el estado,
  // movemos el lead a la etapa correspondiente del embudo (Kommo manda, y el panel
  // ahora también empuja hacia Kommo). Además dejamos la nota de rastro.
  if (s.kommoLeadId) {
    const tenant = await getTenantBySlug(session.slug);
    if (tenant) {
      if (note) addLeadNote(tenant, s.kommoLeadId, note);
      if (newStep) {
        const kstatus = kommoStatusFromPanelStep(tenant, newStep);
        if (kstatus) updateLeadStatus(tenant, s.kommoLeadId, kstatus).catch(() => {});
      }
    }
  }

  // APPROVE: acreditación idempotente + mover Kommo a Cargo$ + emitir CargoCRM.
  if (b.op === 'approve') {
    const tenant = await getTenantBySlug(session.slug);
    if (tenant) {
      // Agrega el mensaje "¡Acreditado!" UNA sola vez (candado atómico). Aunque
      // después llegue el webhook de Cargo$ o el poll, no se duplica. El panel
      // recarga el detalle tras la acción, así que el operador lo ve igual.
      await acreditarChat(tenant, { sessionKey: s.sessionKey });
      // Push de acreditación (best-effort): el aviso más importante para el cliente.
      void sendPushToSession(s.id, data.pushSub, {
        title: '¡Acreditado!',
        body: 'Tu carga fue acreditada con éxito.',
        url: `/chat/${session.slug}`,
      });
      // Movemos el lead a Cargo$ (dispara webhook; el candado impide duplicar).
      if (s.kommoLeadId && tenant.statusCargoId) {
        updateLeadStatus(tenant, s.kommoLeadId, tenant.statusCargoId).catch(() => {});
      }
      // Fase 1: dispara CargoCRM a Meta. Kill switch EMIT_CARGO_FROM_PANEL=0.
      if (panelApproveEmitsCargo()) {
        await emitCargo(tenant, {
          kommoLeadId: s.kommoLeadId,
          sessionKey: s.sessionKey,
          source: 'panel',
          operator: session.slug,
          // Si el operador aprobó indicando el monto cargado, lo mandamos en ARS.
          value: b.amount && b.amount > 0 ? b.amount : undefined,
          currency: 'ARS',
          skipKommoStatus: true,
          skipChatRelease: true,
        }).catch((e) => console.error(`[panel/chats ${session.slug}] emitCargo:`, e));
      }
    }
    return NextResponse.json({ ok: true, messages: newMsgs, step: 'done' });
  }

  return NextResponse.json({ ok: true, messages: newMsgs, step: newStep ?? s.step });
}

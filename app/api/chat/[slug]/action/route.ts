import { NextRequest, NextResponse } from 'next/server';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { chatSessions } from '@/db/schema';
import { getTenantBySlug } from '@/lib/tenants';
import { accountStep, cbuStep, postActionMessages, comprobanteReviewMessages, existingUserSupport, supportClientFlags, type BotMsg } from '@/lib/chat/flow';
import { BUY_ACTION_PREFIX, productStepTienda, comprobanteReviewTienda, onFreeTextTienda } from '@/lib/chat/flows/tienda';
import { loadTiendaConfig, loadChatFlow } from '@/lib/chat/loadTienda';
import { advanceByButton } from '@/lib/chat/flowGraph';
import { prepareBotBatch } from '@/lib/chat/stagger';
import { appendChatMessages } from '@/lib/chat/mutations';
import { loadChatRuntime } from '@/lib/chat/loadRuntime';
import { addLeadNote } from '@/lib/chat/kommoMirror';
import { updateLeadFields, updateLeadName, addLeadTags, updateLeadStatus } from '@/lib/kommo';
import { notifyOperators } from '@/lib/panel/operatorPush';
import { sendPushToSession } from '@/lib/chat/push';

export const dynamic = 'force-dynamic';

/** Cierra el gate de app → revisión. No pisa un Cargo ya acreditado (carrera con Aprobar). */
async function applyFinishUpload(
  sessionId: string,
  dbCountBefore: number,
  label: string | undefined,
  reviewMsgs: BotMsg[],
): Promise<{ moved: boolean; body: Record<string, unknown> }> {
  const userTap = label?.trim()
    ? [{ from: 'user' as const, text: label.trim(), at: Date.now() }]
    : [];
  const botMsgs = prepareBotBatch(reviewMsgs);
  const toAdd = [...userTap, ...botMsgs];
  const res = (await db.execute(sql`
    UPDATE chat_sessions
    SET messages = coalesce(messages, '[]'::jsonb) || ${JSON.stringify(toAdd)}::jsonb,
        step = 'validando',
        updated_at = now()
    WHERE id = ${sessionId}
      AND coalesce(data->>'accreditedAt', '') = ''
      AND coalesce(step, '') <> 'done'
    RETURNING id
  `)) as unknown as { length?: number };
  if ((res?.length ?? 0) === 0) {
    if (userTap.length) await appendChatMessages(sessionId, userTap);
    return {
      moved: false,
      body: { ok: true, messages: [], buttons: [], step: 'done', alreadyDone: true, total: dbCountBefore + userTap.length },
    };
  }
  return {
    moved: true,
    body: { ok: true, messages: botMsgs, buttons: [], step: 'validando', total: dbCountBefore + toAdd.length },
  };
}

// POST /api/chat/[slug]/action  { sessionKey, action }  — avanza el flujo por botón.
export async function POST(req: NextRequest, { params }: { params: { slug: string } }) {
  const tenant = await getTenantBySlug(params.slug);
  if (!tenant) return NextResponse.json({ error: 'tenant desconocido' }, { status: 404 });
  const b = (await req.json().catch(() => ({}))) as { sessionKey?: string; action?: string; label?: string };
  if (!b.sessionKey || !b.action) return NextResponse.json({ error: 'sessionKey y action requeridos' }, { status: 400 });

  const [s] = await db.select().from(chatSessions).where(and(eq(chatSessions.tenantId, tenant.id), eq(chatSessions.sessionKey, b.sessionKey)));
  if (!s) return NextResponse.json({ error: 'sesión desconocida' }, { status: 404 });
  if ((s.data as Record<string, unknown> | null)?.blocked) return NextResponse.json({ ok: true, messages: [], blocked: true });

  const runtime = await loadChatRuntime(tenant.id, tenant.name, s.phone, tenant.slug);

  // Persistimos el toque del cliente
  const label = b.label?.trim();
  if (label) s.messages = [...(s.messages ?? []), { from: 'user', text: label, at: Date.now() }];

  // ── Nicho TIENDA: guion propio (producto → pago → comprobante). ───────────
  if (tenant.niche === 'tienda') {
    const cfg = await loadTiendaConfig(tenant.id, tenant.name);

    // Flow custom (nodos+conectores): si está activo, lo maneja el intérprete.
    const flow = await loadChatFlow(tenant.id);
    if (flow.enabled) {
      const sdata = (s.data as Record<string, unknown> | null) ?? {};
      const fromNode = typeof sdata.flowNodeId === 'string' ? sdata.flowNodeId : flow.startId;
      const run = advanceByButton(flow, fromNode, b.action, { cfg, name: s.name, data: sdata });
      if (run) {
        const botMsgs = prepareBotBatch(run.messages);
        const history = [...(s.messages ?? []), ...botMsgs];
        const nextData = { ...run.data, flowNodeId: run.nodeId };
        const upd: Record<string, unknown> = { data: nextData, messages: history, updatedAt: new Date() };
        if (run.step) upd.step = run.step;
        await db.update(chatSessions).set(upd).where(eq(chatSessions.id, s.id));
        return NextResponse.json({ ok: true, messages: botMsgs, buttons: run.buttons, step: run.step ?? s.step, total: history.length });
      }
      // Sin transición para esa acción: no rompemos.
      const persisted = s.messages ?? [];
      if (label) await db.update(chatSessions).set({ messages: persisted, updatedAt: new Date() }).where(eq(chatSessions.id, s.id));
      return NextResponse.json({ ok: true, messages: [], buttons: [], step: s.step, total: persisted.length });
    }

    if (b.action.startsWith(BUY_ACTION_PREFIX)) {
      const productId = b.action.slice(BUY_ACTION_PREFIX.length);
      const r = productStepTienda(cfg, productId);
      const botMsgs = prepareBotBatch(r.messages);
      const history = [...(s.messages ?? []), ...botMsgs];
      await db.update(chatSessions).set({ step: r.step, data: { ...(s.data ?? {}), ...r.data }, messages: history, updatedAt: new Date() }).where(eq(chatSessions.id, s.id));
      return NextResponse.json({ ok: true, messages: botMsgs, buttons: r.buttons, step: r.step, total: history.length });
    }

    if (b.action === 'finish_upload') {
      const dbCountBefore = (s.messages ?? []).length - (label ? 1 : 0);
      const r = await applyFinishUpload(s.id, dbCountBefore, b.label, comprobanteReviewTienda());
      return NextResponse.json(r.body);
    }

    if (b.action === 'support') {
      const botMsgs = prepareBotBatch(onFreeTextTienda('support', cfg));
      const history = [...(s.messages ?? []), ...botMsgs];
      await db.update(chatSessions).set({ messages: history, updatedAt: new Date() }).where(eq(chatSessions.id, s.id));
      return NextResponse.json({ ok: true, messages: botMsgs, buttons: [], step: s.step, total: history.length });
    }

    // Acción no reconocida en tienda: no rompemos el flujo.
    const persisted = s.messages ?? [];
    if (label) await db.update(chatSessions).set({ messages: persisted, updatedAt: new Date() }).where(eq(chatSessions.id, s.id));
    return NextResponse.json({ ok: true, messages: [], buttons: [], step: s.step, total: persisted.length });
  }

  if (b.action === 'want_account' || (b.action === 'want_agent' && tenant.provider === 'manual')) {
    const existing = (s.data ?? {}) as Record<string, unknown>;
    const r = await accountStep(tenant, { phone: s.phone ?? '', name: s.name, existing }, runtime);
    const botMsgs = prepareBotBatch(r.messages);
    const history = [...(s.messages ?? []), ...botMsgs];
    const nextData = {
      ...existing,
      ...r.data,
      ...(r.step === 'account_pending' ? { unread: true } : {}),
      ...(b.action === 'want_agent' ? { requestedAgent: true } : {}),
    };
    await db.update(chatSessions).set({ step: r.step, data: nextData, messages: history, updatedAt: new Date() }).where(eq(chatSessions.id, s.id));
    // Provider manual: la cuenta la crea el operador a mano → avisale por push que
    // hay una creación pendiente de confirmar (solo tenants manuales).
    if (r.step === 'account_pending' && !existing.manualPending) {
      void notifyOperators(tenant, 'account_pending', { sessionKey: s.sessionKey, name: s.name });
    }
    // Espejo Kommo — MISMA paridad que el bot de WhatsApp: campos PORTAL_* +
    // título del lead = username creado.
    if (s.kommoLeadId && r.data.username) {
      const fields: Array<{ fieldId: number; value: string }> = [];
      const uF = tenant.customFields['portal_url_field'];
      const usF = tenant.customFields['portal_user_field'];
      const pF = tenant.customFields['portal_pass_field'];
      if (uF && r.data.loginUrl) fields.push({ fieldId: uF, value: String(r.data.loginUrl) });
      if (usF) fields.push({ fieldId: usF, value: String(r.data.username) });
      if (pF && r.data.password) fields.push({ fieldId: pF, value: String(r.data.password) });
      if (fields.length) updateLeadFields(tenant, s.kommoLeadId, fields).catch(() => {});
      updateLeadName(tenant, s.kommoLeadId, String(r.data.username)).catch(() => {});
      addLeadNote(tenant, s.kommoLeadId, `👤 Usuario Pagoda ${r.data.existing ? '(existente, recordado)' : 'creado'}: ${r.data.username}`);
    }
    if (r.data.username) {
      void sendPushToSession(s.id, (s.data as Record<string, unknown> | null)?.pushSub, {
        title: '¡Tu cuenta está lista!',
        body: 'Ya te dejamos tu usuario y contraseña en el chat.',
        url: `/chat/${params.slug}`,
      });
    }
    return NextResponse.json({ ok: true, messages: botMsgs, buttons: r.buttons, step: r.step, total: history.length, ...supportClientFlags(nextData, r.step) });
  }

  // Ya tiene usuario: no crea otra cuenta, abre el hop de WhatsApp (header + botón).
  if (b.action === 'have_user') {
    const existing = (s.data ?? {}) as Record<string, unknown>;
    const r = existingUserSupport(runtime, existing, s.step);
    const botMsgs = prepareBotBatch(r.messages);
    const history = [...(s.messages ?? []), ...botMsgs];
    await db.update(chatSessions).set({ step: r.step, data: { ...r.data, unread: true }, messages: history, updatedAt: new Date() }).where(eq(chatSessions.id, s.id));
    void notifyOperators(tenant, 'support', { sessionKey: s.sessionKey, name: s.name });
    if (s.kommoLeadId) addLeadNote(tenant, s.kommoLeadId, '🔁 El cliente dijo que YA TIENE usuario — derivado a WhatsApp.');
    return NextResponse.json({ ok: true, messages: botMsgs, buttons: r.buttons, step: r.step, total: history.length, ...supportClientFlags(r.data, r.step) });
  }

  // "Hablar con un agente" (King/Paradise): crea IGUAL la cuenta por emergencia
  // (para que vaya probando) y además marca la sesión para atención humana → cae
  // en "Atención" del panel (markUnread) y mueve el lead a Atención manual en Kommo.
  if (b.action === 'want_agent') {
    const r = await accountStep(tenant, { phone: s.phone ?? '', name: s.name, existing: (s.data ?? {}) as Record<string, unknown> }, runtime);
    const botMsgs = prepareBotBatch(r.messages);
    const handoff = {
      from: 'bot' as const,
      delayMs: 900,
      at: Date.now(),
      text: '🙌 Listo, te dejé tu cuenta creada para que vayas probando la plataforma. En unos segundos un agente te escribe por acá para ayudarte 👇',
    };
    const userTap = label ? [{ from: 'user' as const, text: label, at: Date.now() }] : [];
    await appendChatMessages(s.id, [...userTap, ...botMsgs, handoff], {
      step: r.step,
      dataMerge: { ...r.data, requestedAgent: true },
      markUnread: true,
    });
    // Espejo Kommo: mismos campos PORTAL_* que want_account + mover a Atención manual.
    if (s.kommoLeadId && r.data.username) {
      const fields: Array<{ fieldId: number; value: string }> = [];
      const uF = tenant.customFields['portal_url_field'];
      const usF = tenant.customFields['portal_user_field'];
      const pF = tenant.customFields['portal_pass_field'];
      if (uF && r.data.loginUrl) fields.push({ fieldId: uF, value: String(r.data.loginUrl) });
      if (usF) fields.push({ fieldId: usF, value: String(r.data.username) });
      if (pF && r.data.password) fields.push({ fieldId: pF, value: String(r.data.password) });
      if (fields.length) updateLeadFields(tenant, s.kommoLeadId, fields).catch(() => {});
      updateLeadName(tenant, s.kommoLeadId, String(r.data.username)).catch(() => {});
      addLeadNote(tenant, s.kommoLeadId, `🧑‍💼 El cliente pidió HABLAR CON UN AGENTE desde el chat. Usuario ${r.data.existing ? '(existente, recordado)' : 'creado'}: ${r.data.username}`);
      addLeadTags(tenant, s.kommoLeadId, ['Atención agente']).catch(() => {});
      const clientesPipe = tenant.customFields['clientes_pipeline'];
      const atencionManual = tenant.customFields['status_atencion_manual'];
      if (clientesPipe && atencionManual) {
        updateLeadStatus(tenant, s.kommoLeadId, atencionManual, clientesPipe).catch(() => {});
      }
    }
    const total = (s.messages?.length ?? 0) + botMsgs.length + 1;
    return NextResponse.json({ ok: true, messages: [...botMsgs, handoff], buttons: r.buttons, step: r.step, total, ...supportClientFlags({ ...r.data, requestedAgent: true }, r.step) });
  }

  if (b.action === 'want_cbu') {
    const r = await cbuStep(tenant, runtime);
    const botMsgs = prepareBotBatch(r.messages);
    const history = [...(s.messages ?? []), ...botMsgs];
    // Persistimos cbu/titular y marcamos atención: ElGanador entra por este botón.
    await db.update(chatSessions).set({
      step: r.step,
      data: { ...(s.data ?? {}), ...r.data, unread: true },
      messages: history,
      updatedAt: new Date(),
    }).where(eq(chatSessions.id, s.id));
    void notifyOperators(tenant, 'cbu', { sessionKey: s.sessionKey, name: s.name });
    if (s.kommoLeadId) addLeadNote(tenant, s.kommoLeadId, '💳 Pidió CBU — datos entregados.');
    return NextResponse.json({ ok: true, messages: botMsgs, buttons: [], step: r.step, total: history.length });
  }

  // FINALIZAR envío del comprobante: recién ahora (tras instalar app + notifs) el
  // comprobante entra en revisión y el lead se mueve a "Revisar imagen" en Kommo.
  // Si el operador ya acreditó (Cargo), no volvemos a "validando" ni pisamos el hilo.
  if (b.action === 'finish_upload') {
    const dbCountBefore = (s.messages ?? []).length - (label ? 1 : 0);
    const r = await applyFinishUpload(s.id, dbCountBefore, b.label, comprobanteReviewMessages(runtime));
    if (r.moved && s.kommoLeadId && tenant.statusRevisarImagenId) {
      updateLeadStatus(tenant, s.kommoLeadId, tenant.statusRevisarImagenId).catch(() => {});
      addLeadNote(tenant, s.kommoLeadId, '🔎 Comprobante en revisión (app instalada). ➡️ Chequealo y mové a Cargo$ para acreditar.');
    }
    if (r.moved) void notifyOperators(tenant, 'comprobante', { sessionKey: s.sessionKey, name: s.name });
    return NextResponse.json(r.body);
  }

  // Opciones POST-acreditación (depositar / retirar / soporte / olvidé usuario / cancelar).
  const POST_ACTIONS = ['deposit', 'withdraw', 'support', 'forgot_user', 'cancel'];
  if (POST_ACTIONS.includes(b.action)) {
    const r = postActionMessages(b.action, (s.data ?? {}) as Record<string, unknown>, runtime);
    const botMsgs = prepareBotBatch(r.messages);
    const history = [...(s.messages ?? []), ...botMsgs];
    const patch: Record<string, unknown> = { messages: history, updatedAt: new Date() };
    if (r.step) patch.step = r.step;
    await db.update(chatSessions).set(patch).where(eq(chatSessions.id, s.id));
    // Soporte: dejar rastro + etiqueta y MOVER a Atención manual (embudo Clientes)
    // para que un asesor lo tome.
    if (b.action === 'support') {
      // Provider manual: push de fondo al operador (además del rastro en Kommo).
      void notifyOperators(tenant, 'support', { sessionKey: s.sessionKey, name: s.name });
    }
    if (b.action === 'support' && s.kommoLeadId) {
      addLeadNote(tenant, s.kommoLeadId, '🆘 El cliente pidió SOPORTE desde el chat web.');
      addLeadTags(tenant, s.kommoLeadId, ['Soporte']).catch(() => {});
      const clientesPipe = tenant.customFields['clientes_pipeline'];
      const atencionManual = tenant.customFields['status_atencion_manual'];
      if (clientesPipe && atencionManual) {
        updateLeadStatus(tenant, s.kommoLeadId, atencionManual, clientesPipe).catch(() => {});
      }
    }
    return NextResponse.json({ ok: true, messages: botMsgs, buttons: [], step: r.step ?? s.step, total: history.length });
  }

  return NextResponse.json({ ok: true, messages: [], buttons: [], total: (s.messages ?? []).length });
}

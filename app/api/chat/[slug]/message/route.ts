import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { chatSessions } from '@/db/schema';
import { getTenantBySlug } from '@/lib/tenants';
import { onFreeText, accountStep, existingUserSupport, WANT_ACCOUNT_RE, HAVE_USER_RE, HELP_RE, sessionCanOpenSupport, supportClientFlags } from '@/lib/chat/flow';
import { onFreeTextTienda } from '@/lib/chat/flows/tienda';
import { loadTiendaConfig, loadChatFlow } from '@/lib/chat/loadTienda';
import { advanceByText } from '@/lib/chat/flowGraph';
import { prepareBotBatch } from '@/lib/chat/stagger';
import { appendChatMessages } from '@/lib/chat/mutations';
import { loadChatRuntime } from '@/lib/chat/loadRuntime';
import { addLeadNote } from '@/lib/chat/kommoMirror';
import { updateLeadFields, updateLeadName } from '@/lib/kommo';
import { notifyOperators } from '@/lib/panel/operatorPush';
import { sendPushToSession } from '@/lib/chat/push';

export const dynamic = 'force-dynamic';

// POST /api/chat/[slug]/message  { sessionKey, text }
export async function POST(req: NextRequest, { params }: { params: { slug: string } }) {
  const tenant = await getTenantBySlug(params.slug);
  if (!tenant) return NextResponse.json({ error: 'tenant desconocido' }, { status: 404 });
  const b = (await req.json().catch(() => ({}))) as { sessionKey?: string; text?: string };
  if (!b.sessionKey || !b.text) return NextResponse.json({ error: 'sessionKey y text requeridos' }, { status: 400 });

  const [s] = await db.select().from(chatSessions).where(and(eq(chatSessions.tenantId, tenant.id), eq(chatSessions.sessionKey, b.sessionKey)));
  if (!s) return NextResponse.json({ error: 'sesión desconocida' }, { status: 404 });
  // Bloqueado: ignoramos el mensaje (no se guarda, no reabre la bandeja).
  if ((s.data as Record<string, unknown> | null)?.blocked) return NextResponse.json({ ok: true, messages: [], blocked: true });

  const runtime = await loadChatRuntime(tenant.id, tenant.name, s.phone, tenant.slug);

  const userMsg = { from: 'user' as const, text: b.text, at: Date.now() };

  // ── Nicho TIENDA: guion propio. Sin "quiero mi cuenta"/Pagoda. ─────────────
  if (tenant.niche === 'tienda') {
    const cfg = await loadTiendaConfig(tenant.id, tenant.name);
    const sdata = (s.data as Record<string, unknown> | null) ?? {};

    // Flow custom: si estamos en un nodo 'capture' avanzamos con el texto; si no,
    // respondemos el fallback global del flow (sin romper el guion).
    const flow = await loadChatFlow(tenant.id);
    if (flow.enabled && !sdata.operatorTookOver) {
      const fromNode = typeof sdata.flowNodeId === 'string' ? sdata.flowNodeId : flow.startId;
      const run = advanceByText(flow, fromNode, b.text, { cfg, name: s.name, data: sdata });
      let replies = run ? run.messages : (flow.fallback ? [{ from: 'bot' as const, delayMs: 600, at: Date.now(), text: flow.fallback }] : []);
      const botMsgs = prepareBotBatch(replies);
      const upd: Record<string, unknown> = { updatedAt: new Date() };
      if (run) { upd.data = { ...run.data, flowNodeId: run.nodeId }; if (run.step) upd.step = run.step; }
      await appendChatMessages(s.id, [userMsg, ...botMsgs], { markUnread: true });
      if (run) await db.update(chatSessions).set(upd).where(eq(chatSessions.id, s.id));
      const history = [...(s.messages ?? []), userMsg, ...botMsgs];
      if (s.kommoLeadId) addLeadNote(tenant, s.kommoLeadId, `👤 Lead: ${b.text}`);
      await notifyOperators(tenant, 'message', { sessionKey: s.sessionKey, name: s.name, text: b.text });
      return NextResponse.json({ ok: true, messages: botMsgs, total: history.length });
    }

    let replies = onFreeTextTienda(s.step ?? 'welcome', cfg);
    if (sdata.operatorTookOver) replies = [];
    const prevMsgs = (s.messages ?? []) as Array<{ from: string; text?: string }>;
    const lastBot = [...prevMsgs].reverse().find((m) => m.from === 'bot');
    if (replies.length === 1 && lastBot && (lastBot.text ?? '') === (replies[0].text ?? '')) replies = [];
    const botMsgs = prepareBotBatch(replies);
    await appendChatMessages(s.id, [userMsg, ...botMsgs], { markUnread: true });
    const history = [...(s.messages ?? []), userMsg, ...botMsgs];
    if (s.kommoLeadId) addLeadNote(tenant, s.kommoLeadId, `👤 Lead: ${b.text}`);
    await notifyOperators(tenant, 'message', { sessionKey: s.sessionKey, name: s.name, text: b.text });
    return NextResponse.json({ ok: true, messages: botMsgs, total: history.length });
  }

  // El cliente tipeó "quiero mi cuenta" en vez de tocar el botón (muy común en mobile).
  if ((s.step ?? 'welcome') === 'welcome' && WANT_ACCOUNT_RE.test(b.text)) {
    const existing = (s.data ?? {}) as Record<string, unknown>;
    const r = await accountStep(tenant, { phone: s.phone ?? '', name: s.name, existing }, runtime);
    const botMsgs = prepareBotBatch(r.messages);
    await appendChatMessages(s.id, [userMsg, ...botMsgs], { step: r.step, dataMerge: r.data, markUnread: true });
    const history = [...(s.messages ?? []), userMsg, ...botMsgs];
    if (r.step === 'account_pending' && !existing.manualPending) {
      await notifyOperators(tenant, 'account_pending', { sessionKey: s.sessionKey, name: s.name });
    } else {
      await notifyOperators(tenant, 'message', { sessionKey: s.sessionKey, name: s.name, text: b.text });
    }
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
      addLeadNote(tenant, s.kommoLeadId, `👤 Usuario Pagoda ${r.data.existing ? '(existente, recordado)' : 'creado'} (por texto): ${r.data.username}`);
    }
    if (r.data.username) {
      void sendPushToSession(s.id, (s.data as Record<string, unknown> | null)?.pushSub, {
        title: '¡Tu cuenta está lista!',
        body: 'Ya te dejamos tu usuario y contraseña en el chat.',
        url: `/chat/${params.slug}`,
      });
    }
    return NextResponse.json({ ok: true, messages: botMsgs, buttons: r.buttons, step: r.step, total: history.length, ...supportClientFlags({ ...existing, ...r.data }, r.step) });
  }

  if ((s.step ?? 'welcome') === 'welcome' && HAVE_USER_RE.test(b.text)) {
    const existing = (s.data ?? {}) as Record<string, unknown>;
    const r = existingUserSupport(runtime, existing, s.step);
    const botMsgs = prepareBotBatch(r.messages);
    await appendChatMessages(s.id, [userMsg, ...botMsgs], { step: r.step, dataMerge: r.data, markUnread: true });
    const history = [...(s.messages ?? []), userMsg, ...botMsgs];
    await notifyOperators(tenant, 'support', { sessionKey: s.sessionKey, name: s.name });
    if (s.kommoLeadId) addLeadNote(tenant, s.kommoLeadId, '🔁 El cliente escribió que YA TIENE usuario — derivado a WhatsApp.');
    return NextResponse.json({ ok: true, messages: botMsgs, buttons: r.buttons, step: r.step, total: history.length, ...supportClientFlags(r.data, r.step) });
  }

  let replies = onFreeText(s.step ?? 'comprobante', b.text, runtime, (s.data ?? {}) as Record<string, unknown>);
  // OPERADOR AL MANDO: si un humano ya intervino con un mensaje libre, el bot se
  // calla. No tiene sentido que reinyecte "mandame el comprobante" mientras el
  // operador está resolviendo otra cosa con el cliente.
  if ((s.data as Record<string, unknown> | null)?.operatorTookOver) {
    replies = [];
  }
  // ANTI-LOOP: no repetir el MISMO auto-mensaje si ya fue el último del bot. El
  // cliente sigue escribiendo ("no tengo plata", etc.) y no tiene sentido repetir
  // "mandame el comprobante" cada vez. Lo decimos una vez y esperamos.
  const prevMsgs = (s.messages ?? []) as Array<{ from: string; text?: string }>;
  const lastBot = [...prevMsgs].reverse().find((m) => m.from === 'bot');
  if (replies.length === 1 && lastBot && (lastBot.text ?? '') === (replies[0].text ?? '')) {
    replies = [];
  }
  const botMsgs = prepareBotBatch(replies);
  // Inbound del cliente → marca NO LEÍDO (pendiente de responder) y, si estaba
  // archivado, se reabre solo (vuelve a la bandeja). Append atómico (no pisa lo que
  // escriba el scheduler de recordatorios o el operador en paralelo).
  await appendChatMessages(s.id, [userMsg, ...botMsgs], { markUnread: true });
  const history = [...(s.messages ?? []), userMsg, ...botMsgs];

  if (s.kommoLeadId) addLeadNote(tenant, s.kommoLeadId, `👤 Lead: ${b.text}`);

  // Manual: cada inbound avisa al operador. Soporte post-carga usa copy propio.
  if (HELP_RE.test(b.text) && sessionCanOpenSupport((s.data ?? {}) as Record<string, unknown>, s.step)) {
    await notifyOperators(tenant, 'support', { sessionKey: s.sessionKey, name: s.name });
  } else {
    await notifyOperators(tenant, 'message', { sessionKey: s.sessionKey, name: s.name, text: b.text });
  }

  return NextResponse.json({ ok: true, messages: botMsgs, total: history.length });
}

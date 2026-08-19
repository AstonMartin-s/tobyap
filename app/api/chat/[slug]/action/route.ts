import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { chatSessions } from '@/db/schema';
import { getTenantBySlug } from '@/lib/tenants';
import { accountStep, cbuStep, postActionMessages, comprobanteReviewMessages } from '@/lib/chat/flow';
import { addLeadNote } from '@/lib/chat/kommoMirror';
import { updateLeadFields, updateLeadName, addLeadTags, updateLeadStatus } from '@/lib/kommo';

export const dynamic = 'force-dynamic';

// POST /api/chat/[slug]/action  { sessionKey, action }  — avanza el flujo por botón.
export async function POST(req: NextRequest, { params }: { params: { slug: string } }) {
  const tenant = await getTenantBySlug(params.slug);
  if (!tenant) return NextResponse.json({ error: 'tenant desconocido' }, { status: 404 });
  const b = (await req.json().catch(() => ({}))) as { sessionKey?: string; action?: string; label?: string };
  if (!b.sessionKey || !b.action) return NextResponse.json({ error: 'sessionKey y action requeridos' }, { status: 400 });

  const [s] = await db.select().from(chatSessions).where(and(eq(chatSessions.tenantId, tenant.id), eq(chatSessions.sessionKey, b.sessionKey)));
  if (!s) return NextResponse.json({ error: 'sesión desconocida' }, { status: 404 });
  if ((s.data as Record<string, unknown> | null)?.blocked) return NextResponse.json({ ok: true, messages: [], blocked: true });

  // Persistimos el toque del cliente (la etiqueta del botón) como mensaje suyo,
  // así el panel del operador ve la conversación completa (antes solo se guardaban
  // las respuestas del bot y se veía "coja").
  const label = b.label?.trim();
  if (label) s.messages = [...(s.messages ?? []), { from: 'user', text: label, at: Date.now() }];

  if (b.action === 'want_account') {
    const r = await accountStep(tenant, { phone: s.phone ?? '', name: s.name });
    const history = [...(s.messages ?? []), ...r.messages.map((m) => ({ from: 'bot' as const, text: m.text, at: m.at }))];
    await db.update(chatSessions).set({ step: r.step, data: { ...(s.data ?? {}), ...r.data }, messages: history, updatedAt: new Date() }).where(eq(chatSessions.id, s.id));
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
    return NextResponse.json({ ok: true, messages: r.messages, buttons: r.buttons, step: r.step, total: history.length });
  }

  if (b.action === 'want_cbu') {
    const r = await cbuStep(tenant);
    const history = [...(s.messages ?? []), ...r.messages.map((m) => ({ from: 'bot' as const, text: m.text, at: m.at }))];
    // Persistimos cbu/titular en la sesión para poder re-enviarlos en los recordatorios.
    await db.update(chatSessions).set({ step: r.step, data: { ...(s.data ?? {}), ...r.data }, messages: history, updatedAt: new Date() }).where(eq(chatSessions.id, s.id));
    if (s.kommoLeadId) addLeadNote(tenant, s.kommoLeadId, '💳 Pidió CBU — datos entregados.');
    return NextResponse.json({ ok: true, messages: r.messages, buttons: [], step: r.step, total: history.length });
  }

  // FINALIZAR envío del comprobante: recién ahora (tras instalar app + notifs) el
  // comprobante entra en revisión y el lead se mueve a "Revisar imagen" en Kommo.
  if (b.action === 'finish_upload') {
    const msgs = comprobanteReviewMessages();
    const history = [...(s.messages ?? []), ...msgs.map((m) => ({ from: 'bot' as const, text: m.text, at: m.at }))];
    await db.update(chatSessions).set({ step: 'validando', messages: history, updatedAt: new Date() }).where(eq(chatSessions.id, s.id));
    if (s.kommoLeadId && tenant.statusRevisarImagenId) {
      updateLeadStatus(tenant, s.kommoLeadId, tenant.statusRevisarImagenId).catch(() => {});
      addLeadNote(tenant, s.kommoLeadId, '🔎 Comprobante en revisión (app instalada). ➡️ Chequealo y mové a Cargo$ para acreditar.');
    }
    return NextResponse.json({ ok: true, messages: msgs, buttons: [], step: 'validando', total: history.length });
  }

  // Opciones POST-acreditación (depositar / retirar / soporte / olvidé usuario / cancelar).
  const POST_ACTIONS = ['deposit', 'withdraw', 'support', 'forgot_user', 'cancel'];
  if (POST_ACTIONS.includes(b.action)) {
    const r = postActionMessages(b.action, (s.data ?? {}) as Record<string, unknown>);
    const history = [...(s.messages ?? []), ...r.messages.map((m) => ({ from: 'bot' as const, text: m.text, image: m.image, at: m.at }))];
    const patch: Record<string, unknown> = { messages: history, updatedAt: new Date() };
    if (r.step) patch.step = r.step;
    await db.update(chatSessions).set(patch).where(eq(chatSessions.id, s.id));
    // Soporte: dejar rastro + etiqueta y MOVER a Atención manual (embudo Clientes)
    // para que un asesor lo tome.
    if (b.action === 'support' && s.kommoLeadId) {
      addLeadNote(tenant, s.kommoLeadId, '🆘 El cliente pidió SOPORTE desde el chat web.');
      addLeadTags(tenant, s.kommoLeadId, ['Soporte']).catch(() => {});
      const clientesPipe = tenant.customFields['clientes_pipeline'];
      const atencionManual = tenant.customFields['status_atencion_manual'];
      if (clientesPipe && atencionManual) {
        updateLeadStatus(tenant, s.kommoLeadId, atencionManual, clientesPipe).catch(() => {});
      }
    }
    return NextResponse.json({ ok: true, messages: r.messages, buttons: [], step: r.step ?? s.step, total: history.length });
  }

  return NextResponse.json({ ok: true, messages: [], buttons: [], total: (s.messages ?? []).length });
}

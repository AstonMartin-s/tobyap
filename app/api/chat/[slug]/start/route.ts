import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { chatSessions, metaEvents, attributions } from '@/db/schema';
import { getTenantBySlug } from '@/lib/tenants';
import { checkWhatsApp } from '@/lib/chat/wachecker';
import { welcomeStep, welcomeButtons, hasAgentButton, type Btn } from '@/lib/chat/flow';
import { welcomeStepTienda, productButtons } from '@/lib/chat/flows/tienda';
import { loadTiendaConfig } from '@/lib/chat/loadTienda';
import { prepareBotBatch } from '@/lib/chat/stagger';
import { loadChatRuntime } from '@/lib/chat/loadRuntime';
import { createChatLead, addLeadNote } from '@/lib/chat/kommoMirror';
import { sendCapiEvent, conversationValue } from '@/lib/meta';
import { clientIp, rateLimit } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';

// POST /api/chat/[slug]/start  { phone, name?, token?, campaign?, ccpp? }
export async function POST(req: NextRequest, { params }: { params: { slug: string } }) {
  const limit = Number(process.env.RATE_LIMIT_CHAT_START ?? 20);
  const rl = rateLimit(`chat-start:${params.slug}:${clientIp(req)}`, limit, 60_000);
  if (!rl.ok) {
    return NextResponse.json({ error: 'rate limit' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } });
  }

  const tenant = await getTenantBySlug(params.slug);
  if (!tenant) return NextResponse.json({ error: 'tenant desconocido' }, { status: 404 });

  const b = (await req.json().catch(() => ({}))) as Record<string, string>;
  if (!b.phone) return NextResponse.json({ error: 'phone requerido' }, { status: 400 });

  const wa = await checkWhatsApp(b.phone);
  if (!wa.ok) {
    return NextResponse.json({ ok: false, error: wa.reason === 'sin WhatsApp' ? 'Ese número no tiene WhatsApp. Poné el correcto para recibir tu bonificación.' : 'Número inválido. Revisá que esté completo.' }, { status: 422 });
  }

  const runtime = await loadChatRuntime(tenant.id, tenant.name, wa.phone, tenant.slug);

  // Nicho: TIENDA usa un guion propio (producto/pago/comprobante), sin cuenta/CBU.
  const isTienda = tenant.niche === 'tienda';
  const tiendaCfg = isTienda ? await loadTiendaConfig(tenant.id, tenant.name) : null;
  // King/Paradise: 2º botón "Hablar con un agente" en el welcome.
  const agentBtn = hasAgentButton(tenant.slug);
  const buildWelcome = (name?: string | null): { messages: ReturnType<typeof welcomeStep>['messages']; buttons: Btn[] } =>
    isTienda ? welcomeStepTienda(name, tiendaCfg!) : welcomeStep(name, runtime, { agentButton: agentBtn });
  const buttonsForStep = (step: string): Btn[] => {
    if (isTienda) return step === 'welcome' ? productButtons(tiendaCfg!) : [];
    return step === 'welcome'
      ? welcomeButtons(agentBtn)
      : step === 'credenciales'
        ? [{ id: 'want_cbu', label: 'Quiero el CBU 💳' }]
        : [];
  };

  // DEDUPE POR TELÉFONO
  const existing = await db.query.chatSessions.findFirst({
    where: and(eq(chatSessions.tenantId, tenant.id), eq(chatSessions.phone, wa.phone)),
    orderBy: [desc(chatSessions.updatedAt)],
  });
  if (existing) {
    // Bloqueado: devolvemos la sesión tal cual, sin reabrir ni crear lead (los
    // endpoints de mensaje/upload también lo rechazan).
    if ((existing.data as Record<string, unknown> | null)?.blocked) {
      const msgs = existing.messages ?? [];
      return NextResponse.json({ ok: true, resumed: true, sessionKey: existing.sessionKey, messages: msgs, buttons: [], step: existing.step ?? 'welcome', total: msgs.length, leadId: existing.kommoLeadId ?? null });
    }
    const terminal = ['closed', 'no_cargo'].includes(existing.step ?? '');
    if (terminal) {
      // Vuelve tras cerrar/no-cargar: reabrimos EN LA MISMA fila con una bienvenida.
      const w = buildWelcome(b.name ?? existing.name);
      const welcomeMsgs = prepareBotBatch(w.messages);
      const history = [...(existing.messages ?? []), ...welcomeMsgs];
      await db.update(chatSessions).set({ step: 'welcome', messages: history, updatedAt: new Date() }).where(eq(chatSessions.id, existing.id));
      return NextResponse.json({ ok: true, resumed: true, sessionKey: existing.sessionKey, messages: history, buttons: w.buttons, step: 'welcome', total: history.length, leadId: existing.kommoLeadId ?? null });
    }
    // Sesión activa: la reanudamos tal cual (historial + estado actuales).
    if (b.name && !existing.name) await db.update(chatSessions).set({ name: b.name, updatedAt: new Date() }).where(eq(chatSessions.id, existing.id));
    const step = existing.step ?? 'welcome';
    const buttons = buttonsForStep(step);
    const msgs = existing.messages ?? [];
    return NextResponse.json({ ok: true, resumed: true, sessionKey: existing.sessionKey, messages: msgs, buttons, step, total: msgs.length, leadId: existing.kommoLeadId ?? null });
  }

  const sessionKey = crypto.randomBytes(12).toString('hex');
  const leadId = await createChatLead(tenant, { phone: wa.phone, name: b.name, token: b.token, campaign: b.campaign, ccpp: b.ccpp });
  if (!leadId) {
    console.error(`[chat start] ${tenant.slug}: no se pudo crear el lead en Kommo (tel ${wa.phone}). Igual medimos la conversión a Meta.`);
  }

  const { messages, buttons } = buildWelcome(b.name);
  const welcomeMsgs = prepareBotBatch(messages);

  await db.insert(chatSessions).values({
    tenantId: tenant.id,
    sessionKey,
    phone: wa.phone,
    name: b.name ?? null,
    waVerified: wa.onWhatsApp === true,
    token: b.token ?? null,
    campaign: b.campaign ?? null,
    ccpp: b.ccpp ?? null,
    step: 'welcome',
    kommoLeadId: leadId,
    data: {},
    messages: welcomeMsgs,
    updatedAt: new Date(),
  });

  // Leemos la atribución del token SIEMPRE, independiente de si el lead se creó
  // en Kommo: el evento a Meta no puede depender de que Kommo ande bien, son dos
  // sistemas separados y uno no debe tumbar al otro.
  let attr: { campaignId: string | null; fbc: string | null; fbp: string | null; fbclid: string | null; eventSourceUrl: string | null } | null = null;
  if (b.token) {
    const row = await db.query.attributions.findFirst({
      where: and(eq(attributions.tenantId, tenant.id), eq(attributions.code, b.token)),
    });
    if (row) attr = { campaignId: row.campaignId, fbc: row.fbc, fbp: row.fbp, fbclid: row.fbclid, eventSourceUrl: row.eventSourceUrl };
  }

  // El lead ya se crea con etiquetas (Chat Web + campaña + bono), custom fields
  // y la atribución matcheada en UNA sola llamada dentro de createChatLead. Acá
  // sólo dejamos la nota (best-effort, paceada por el throttle).
  if (leadId) {
    addLeadNote(tenant, leadId, `🌐 Chat web iniciado. Tel: ${wa.phone}${wa.onWhatsApp === true ? ' (WA ✓)' : ''}`);
  }

  // CONVERSACIÓN a Meta (idempotente): manda el TELÉFONO capturado (Meta lo
  // hashea SHA-256) + fbc/fbp/fbclid. NO depende de que el lead se haya creado en
  // Kommo — antes un fallo del mirror tumbaba también la medición en Meta.
  if (tenant.metaPixelId && tenant.metaCapiToken) {
    const convId = leadId ? `conv-${leadId}` : `conv-session-${sessionKey}`;
    const dup = await db.query.metaEvents.findFirst({
      where: and(eq(metaEvents.tenantId, tenant.id), eq(metaEvents.eventId, convId), eq(metaEvents.status, 'sent')),
    });
    if (!dup) {
      sendCapiEvent(tenant, {
        eventName: 'Conversacion',
        eventId: convId,
        userData: { phone: wa.phone, fbc: attr?.fbc, fbp: attr?.fbp, fbclid: attr?.fbclid },
        customData: { campaign_id: attr?.campaignId ?? b.campaign, internal_event: 'ConversacionCRM', ...conversationValue(tenant) },
        eventSourceUrl: attr?.eventSourceUrl ?? null,
        leadId: null,
      }).catch(() => {});
    }
  }

  return NextResponse.json({ ok: true, sessionKey, messages: welcomeMsgs, buttons, step: 'welcome', leadId: leadId ?? null });
}

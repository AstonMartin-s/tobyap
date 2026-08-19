import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { chatSessions } from '@/db/schema';
import { getSession } from '@/lib/session';
import { getTenantBySlug } from '@/lib/tenants';
import { addLeadNote } from '@/lib/chat/kommoMirror';
import { updateLeadStatus } from '@/lib/kommo';
import { kommoStatusFromPanelStep } from '@/lib/chat/release';
import {
  accreditedMessages,
  comprobantePendingMessages,
  comprobanteRejectedMessages,
  supportMessage,
  postActionMessages,
} from '@/lib/chat/flow';

export const dynamic = 'force-dynamic';

type Msg = { from: 'bot' | 'user'; text?: string; image?: string; at: number; op?: boolean };

// GET /api/panel/chats  → lista de sesiones del tenant logueado (panel operador).
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no autorizado' }, { status: 401 });

  const rows = await db
    .select()
    .from(chatSessions)
    .where(eq(chatSessions.tenantId, session.tenantId))
    .orderBy(desc(chatSessions.updatedAt))
    .limit(200);

  // Stats sobre TODA la base (solo step + fecha, liviano) para que los KPIs no
  // queden capados por el límite de 200 de la lista.
  const statRows = await db
    .select({ step: chatSessions.step, createdAt: chatSessions.createdAt })
    .from(chatSessions)
    .where(eq(chatSessions.tenantId, session.tenantId));

  const items = rows.map((s) => {
    const msgs = (s.messages ?? []) as Msg[];
    const last = msgs[msgs.length - 1];
    const sdata = (s.data ?? {}) as Record<string, unknown>;
    const username = sdata.username as string | undefined;
    return {
      sessionKey: s.sessionKey,
      phone: s.phone,
      name: s.name,
      username: username ?? null, // usuario del portal (ej. camilo787) — búscable
      archived: sdata.archived === true,
      step: s.step,
      kommoLeadId: s.kommoLeadId,
      campaign: s.campaign,
      waVerified: s.waVerified,
      hasComprobante: msgs.some((m) => m.from === 'user' && m.image),
      msgCount: msgs.length,
      lastText: last?.text ?? (last?.image ? '📷 imagen' : ''),
      lastFrom: last?.from ?? null,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    };
  });

  return NextResponse.json({ ok: true, items, stats: statRows });
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

  const b = (await req.json().catch(() => ({}))) as { sessionKey?: string; op?: string; text?: string; step?: string };

  // Exportar acreditados (comprobante aprobado) — no necesita sessionKey. Devuelve
  // usuario del portal + teléfono para cruzar trazabilidad con la base de cargas.
  if (b.op === 'export_done') {
    const rows = await db
      .select()
      .from(chatSessions)
      .where(and(eq(chatSessions.tenantId, session.tenantId), eq(chatSessions.step, 'done')))
      .orderBy(desc(chatSessions.updatedAt));
    const data = rows.map((s) => ({
      nombre: s.name ?? '',
      usuario: (((s.data ?? {}) as Record<string, unknown>).username as string) ?? '',
      telefono: s.phone ?? '',
      campana: s.campaign ?? '',
      acreditado: s.updatedAt ? new Date(s.updatedAt).toISOString() : '',
      kommo: s.kommoLeadId ?? '',
    }));
    return NextResponse.json({ ok: true, rows: data });
  }

  if (!b.sessionKey || !b.op) return NextResponse.json({ error: 'sessionKey y op requeridos' }, { status: 400 });

  const [s] = await db
    .select()
    .from(chatSessions)
    .where(and(eq(chatSessions.tenantId, session.tenantId), eq(chatSessions.sessionKey, b.sessionKey)));
  if (!s) return NextResponse.json({ error: 'sesión desconocida' }, { status: 404 });

  const data = (s.data ?? {}) as Record<string, unknown>;
  const loginUrl = data.loginUrl as string | undefined;

  // Archivar / desarchivar (flag en data, NO toca el estado del embudo). El chat
  // vuelve solo a la bandeja cuando el cliente escribe (ver /message y /upload).
  if (b.op === 'archive' || b.op === 'unarchive') {
    const archived = b.op === 'archive';
    await db.update(chatSessions).set({ data: { ...((s.data ?? {}) as Record<string, unknown>), archived }, updatedAt: new Date() }).where(eq(chatSessions.id, s.id));
    return NextResponse.json({ ok: true, archived });
  }

  // Detalle: devuelve el transcript completo (para abrir la conversación). Quitamos
  // el comprobante en base64 de `data` — pesa MBs y la imagen ya se sirve por /file;
  // bajarlo en cada refresh del panel es puro desperdicio de banda.
  if (b.op === 'get') {
    const { comprobante, ...dataLite } = (s.data ?? {}) as Record<string, unknown>;
    void comprobante;
    return NextResponse.json({ ok: true, session: { ...s, data: dataLite } });
  }

  let newMsgs: Msg[] = [];
  let newStep: string | undefined;
  let note: string | null = null;

  switch (b.op) {
    case 'approve':
      newMsgs = accreditedMessages(loginUrl).map((m) => ({ from: 'bot', text: m.text, at: m.at }));
      newStep = 'done';
      note = '✅ Comprobante APROBADO manualmente desde el panel (ficha entregada en el chat).';
      break;
    case 'pending':
      newMsgs = comprobantePendingMessages().map((m) => ({ from: 'bot', text: m.text, at: m.at }));
      note = '⏳ Comprobante marcado PENDIENTE desde el panel.';
      break;
    case 'reject':
      newMsgs = comprobanteRejectedMessages().map((m) => ({ from: 'bot', text: m.text, at: m.at }));
      newStep = 'comprobante';
      note = '⚠️ Comprobante RECHAZADO desde el panel (se le pidió reenviar).';
      break;
    case 'support':
      newMsgs = supportMessage().map((m) => ({ from: 'bot', text: m.text, at: m.at }));
      note = '🙋 Se le pasó el link de soporte (walink) desde el panel.';
      break;
    case 'deposit':
    case 'withdraw':
    case 'forgot_user': {
      const r = postActionMessages(b.op, data);
      newMsgs = r.messages.map((m) => ({ from: 'bot', text: m.text, image: m.image, at: m.at }));
      break;
    }
    case 'custom': {
      const t = (b.text ?? '').trim();
      if (!t) return NextResponse.json({ error: 'texto vacío' }, { status: 400 });
      newMsgs = [{ from: 'bot', text: t, at: Date.now() }];
      note = `✍️ Mensaje manual del operador: "${t.slice(0, 120)}"`;
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
  // para distinguirlo de los mensajes automáticos (BOT) en la vista.
  const opMsgs = newMsgs.map((m) => ({ ...m, op: true }));
  const history = [...((s.messages ?? []) as Msg[]), ...opMsgs];
  const patch: Record<string, unknown> = { messages: history, updatedAt: new Date() };
  if (newStep) patch.step = newStep;
  await db.update(chatSessions).set(patch).where(eq(chatSessions.id, s.id));

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

  return NextResponse.json({ ok: true, messages: newMsgs, step: newStep ?? s.step });
}

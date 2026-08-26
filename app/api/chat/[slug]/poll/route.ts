import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { chatSessions } from '@/db/schema';
import { getTenantBySlug } from '@/lib/tenants';
import { acreditarChat } from '@/lib/chat/release';
import { fetchKommoLead } from '@/lib/kommo';

export const dynamic = 'force-dynamic';

// GET /api/chat/[slug]/poll?sessionKey=...&since=<n>
// El widget lo consulta mientras está "validando": cuando el OPERADOR mueve el
// lead a Cargo$ en Kommo, acá se detecta y se libera el mensaje de acreditación.
export async function GET(req: NextRequest, { params }: { params: { slug: string } }) {
  const tenant = await getTenantBySlug(params.slug);
  if (!tenant) return NextResponse.json({ error: 'tenant desconocido' }, { status: 404 });
  const sessionKey = req.nextUrl.searchParams.get('sessionKey');
  const since = Number(req.nextUrl.searchParams.get('since') ?? '0');
  if (!sessionKey) return NextResponse.json({ error: 'sessionKey requerido' }, { status: 400 });

  const [s] = await db.select().from(chatSessions).where(and(eq(chatSessions.tenantId, tenant.id), eq(chatSessions.sessionKey, sessionKey)));
  if (!s) return NextResponse.json({ error: 'sesión desconocida' }, { status: 404 });

  let step = s.step ?? 'validando';
  let messages = s.messages ?? [];
  const debug = req.nextUrl.searchParams.get('debug') === '1';
  const dbg: Record<string, unknown> = {};

  // ¿El operador ya movió el lead a Cargo$? Solo consultamos Kommo cuando el
  // widget lo pide (kc=1, ~1 de cada 4 ticks) para no saturar la cuota. El
  // "Aprobar" del panel no depende de esto: libera vía mensajes en la DB.
  const checkKommo = req.nextUrl.searchParams.get('kc') !== '0';
  if (checkKommo && step === 'validando' && s.kommoLeadId && tenant.statusCargoId) {
    try {
      const lead = await fetchKommoLead(tenant, s.kommoLeadId);
      dbg.fetchedStatus = lead.status_id;
      dbg.cargoId = tenant.statusCargoId;
      dbg.match = lead.status_id === tenant.statusCargoId;
      if (lead.status_id === tenant.statusCargoId) {
        // Acreditación idempotente (candado atómico) — NO agrega el mensaje si ya
        // lo mandó el webhook u otra fuente. Releemos para devolver lo actualizado.
        await acreditarChat(tenant, { sessionKey, requireComprobanteStep: true });
        const [fresh] = await db.select({ messages: chatSessions.messages, step: chatSessions.step }).from(chatSessions).where(and(eq(chatSessions.tenantId, tenant.id), eq(chatSessions.sessionKey, sessionKey)));
        messages = fresh?.messages ?? messages;
        step = fresh?.step ?? 'done';
      }
    } catch (e) {
      dbg.error = String(e);
    }
  } else {
    dbg.condSkipped = { step, lead: s.kommoLeadId, cargo: tenant.statusCargoId };
  }

  // Devolvemos solo lo nuevo respecto de `since` (largo de la lista del widget).
  const fresh = messages.slice(Math.max(0, since));
  const assignedWa = ((s.data ?? {}) as Record<string, unknown>).assignedWa ?? null;
  return NextResponse.json({ ok: true, step, total: messages.length, messages: fresh, assignedWa, ...(debug ? { dbg } : {}) });
}

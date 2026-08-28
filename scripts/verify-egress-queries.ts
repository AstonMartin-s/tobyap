/**
 * VERIFICACIÓN READ-ONLY (sin writes) de la optimización de egress (#2).
 * Corre la query VIEJA (select *) y la NUEVA (columnas + jsonb - 'comprobante')
 * sobre datos reales y compara que el resultado MAPEADO (lo que ve el frontend)
 * sea idéntico. Aborta con exit 1 si hay cualquier diferencia.
 *
 * Uso: npx tsx scripts/verify-egress-queries.ts
 */
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { chatSessions } from '@/db/schema';
import { phoneForExport } from '@/lib/phone';

type Msg = { from: 'bot' | 'user'; text?: string; image?: string; at: number; op?: boolean };

// Mapeo idéntico al de app/api/panel/chats/route.ts (items)
function mapItem(s: {
  sessionKey: string; phone: string | null; name: string | null; waVerified: boolean | null;
  campaign: string | null; step: string | null; kommoLeadId: number | null;
  messages: unknown; data: unknown; createdAt: Date | null; updatedAt: Date | null;
}) {
  const msgs = (s.messages ?? []) as Msg[];
  const sdata = (s.data ?? {}) as Record<string, unknown>;
  const username = sdata.username as string | undefined;
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
    username: username ?? null,
    archived: sdata.archived === true,
    unread: sdata.unread === true,
    unreadCount: typeof sdata.unreadCount === 'number' && sdata.unreadCount > 0 ? sdata.unreadCount : (sdata.unread === true ? 1 : 0),
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
}

async function main() {
  let failures = 0;
  const fail = (m: string) => { console.error('❌', m); failures++; };
  const ok = (m: string) => console.log('✅', m);

  // Tenant con más sesiones (para probar sobre datos reales representativos).
  const [t] = (await db.execute(sql`
    SELECT tenant_id, count(*) AS n FROM chat_sessions GROUP BY tenant_id ORDER BY n DESC LIMIT 1
  `)) as unknown as Array<{ tenant_id: string; n: number }>;
  if (!t) { console.log('No hay sesiones; nada que verificar.'); process.exit(0); }
  const tenantId = t.tenant_id;
  console.log(`Tenant de prueba: ${tenantId} (${t.n} sesiones)\n`);

  // ── 1) LISTA: vieja (select *) vs nueva (listCols con jsonb - 'comprobante') ──
  const whereList = eq(chatSessions.tenantId, tenantId);
  const oldRows = await db.select().from(chatSessions).where(whereList).orderBy(desc(chatSessions.updatedAt)).limit(200);

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
    data: sql<Record<string, unknown>>`${chatSessions.data} - 'comprobante'`,
    createdAt: chatSessions.createdAt,
    updatedAt: chatSessions.updatedAt,
  } as const;
  const newRows = await db.select(listCols).from(chatSessions).where(whereList).orderBy(desc(chatSessions.updatedAt)).limit(200);

  if (oldRows.length !== newRows.length) fail(`LISTA: cantidad de filas difiere old=${oldRows.length} new=${newRows.length}`);
  const newBySk = new Map(newRows.map((r) => [r.sessionKey, r]));
  let comprobanteStrippedCount = 0;
  let comprobantePresentInOld = 0;
  for (const oldR of oldRows) {
    const newR = newBySk.get(oldR.sessionKey);
    if (!newR) { fail(`LISTA: falta sessionKey ${oldR.sessionKey} en nueva`); continue; }
    const oldItem = JSON.stringify(mapItem(oldR as never));
    const newItem = JSON.stringify(mapItem(newR as never));
    if (oldItem !== newItem) {
      fail(`LISTA: item difiere para ${oldR.sessionKey}\n  OLD: ${oldItem}\n  NEW: ${newItem}`);
    }
    // Confirmar que el base64 se removió pero el resto de data se conserva.
    const oldData = (oldR.data ?? {}) as Record<string, unknown>;
    const newData = (newR.data ?? {}) as Record<string, unknown>;
    if ('comprobante' in oldData) {
      comprobantePresentInOld++;
      if ('comprobante' in newData) fail(`LISTA: comprobante NO removido en ${oldR.sessionKey}`);
      else comprobanteStrippedCount++;
      // El resto de las claves deben seguir presentes e iguales.
      for (const k of Object.keys(oldData)) {
        if (k === 'comprobante') continue;
        if (JSON.stringify(oldData[k]) !== JSON.stringify(newData[k])) {
          fail(`LISTA: clave data.${k} difiere en ${oldR.sessionKey}`);
        }
      }
    }
  }
  ok(`LISTA: ${oldRows.length} filas, items idénticos. comprobante presente en ${comprobantePresentInOld} filas → removido en ${comprobanteStrippedCount}.`);

  // ── 2) POLL: vieja (select *) vs nueva (columnas + assignedWa) ──
  const sample = oldRows.slice(0, 25);
  let pollChecked = 0;
  for (const oldR of sample) {
    const [newP] = await db
      .select({
        step: chatSessions.step,
        messages: chatSessions.messages,
        kommoLeadId: chatSessions.kommoLeadId,
        assignedWa: sql<string | null>`${chatSessions.data} ->> 'assignedWa'`,
      })
      .from(chatSessions)
      .where(and(eq(chatSessions.tenantId, tenantId), eq(chatSessions.sessionKey, oldR.sessionKey)));
    if (!newP) { fail(`POLL: no encontró ${oldR.sessionKey}`); continue; }
    const oldStep = oldR.step ?? 'validando';
    const oldMsgsLen = (oldR.messages ?? []).length;
    const oldAssigned = ((oldR.data ?? {}) as Record<string, unknown>).assignedWa ?? null;
    if ((newP.step ?? 'validando') !== oldStep) fail(`POLL: step difiere ${oldR.sessionKey}`);
    if ((newP.messages ?? []).length !== oldMsgsLen) fail(`POLL: msgs len difiere ${oldR.sessionKey}`);
    if ((newP.assignedWa ?? null) !== (oldAssigned ?? null)) fail(`POLL: assignedWa difiere ${oldR.sessionKey} old=${oldAssigned} new=${newP.assignedWa}`);
    pollChecked++;
  }
  ok(`POLL: ${pollChecked} sesiones, step/messages/assignedWa idénticos.`);

  // ── 3) EXPORT: vieja (select *) vs nueva (columnas + username) ──
  const oldExport = await db.select().from(chatSessions).where(whereList).orderBy(desc(chatSessions.createdAt)).limit(100);
  const newExport = await db
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
      sessionKey: chatSessions.sessionKey,
    })
    .from(chatSessions)
    .where(whereList)
    .orderBy(desc(chatSessions.createdAt))
    .limit(100);
  const newExpBySk = new Map(newExport.map((r) => [r.sessionKey, r]));
  let expChecked = 0;
  for (const oldR of oldExport) {
    const newR = newExpBySk.get(oldR.sessionKey);
    if (!newR) { fail(`EXPORT: falta ${oldR.sessionKey}`); continue; }
    const oldUser = ((oldR.data ?? {}) as Record<string, unknown>).username ?? '';
    const newUser = newR.username ?? '';
    if (String(oldUser) !== String(newUser)) fail(`EXPORT: username difiere ${oldR.sessionKey} old=${oldUser} new=${newUser}`);
    if (phoneForExport(oldR.phone) !== phoneForExport(newR.phone)) fail(`EXPORT: phone difiere ${oldR.sessionKey}`);
    expChecked++;
  }
  ok(`EXPORT: ${expChecked} filas, username/phone idénticos.`);

  console.log('');
  if (failures > 0) {
    console.error(`\n💥 ${failures} DIFERENCIA(S) DETECTADA(S) — NO deployar.`);
    process.exit(1);
  }
  console.log('🎉 TODO IDÉNTICO. Las queries nuevas devuelven lo mismo que las viejas (solo sin el base64). Seguro para deployar.');
  process.exit(0);
}

main().catch((e) => { console.error('Error en verificación:', e); process.exit(1); });

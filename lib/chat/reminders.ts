import { and, gt, inArray, notInArray } from 'drizzle-orm';
import { db } from '@/db';
import { chatSessions, clientSettings, tenants } from '@/db/schema';
import { wantsEarlyPush } from '@/lib/chat/earlyPush';
import { appendChatMessages } from '@/lib/chat/mutations';

// Recontacto: cada mensaje NUESTRO (bot u operador) que queda sin respuesta
// 5 min → un empujón. No es una sola vez por chat: si después contestan y
// volvemos a escribir y se cuelga otra vez, se manda de nuevo. Un mismo
// mensaje colgado no se re-pica (no spam cada 5 min sobre el mismo).

type Msg = { from: string; text?: string; image?: string; at: number; n?: boolean; op?: boolean };

const QUIET_MIN = 5; // minutos de silencio antes del recontacto

// Mensajitos cortos, rotamos uno al azar. Sin montos ni %: la promo ya está
// en la bienvenida/CBU; Luis (ElGanador) no quiere que el seguimiento la repita.
const NUDGES = [
  '¿Seguís por ahí? 👀',
  '¿Todo bien? Cuando quieras seguimos',
  '¿Seguimos cuando puedas? Acá estamos 👌',
  '¿Estás por ahí? Cualquier cosa avisame',
];

async function reminderTenantIds(
  tenantMeta: Array<{ id: string; slug: string }>,
): Promise<string[]> {
  // ENABLE_REMINDERS=1 → todos. Si no: chat_config.reminders=true (ElGanador) +
  // el piloto de push en el formulario (goldenc/luck/piliking/kingplay).
  // King/bblack no — les molestaba la repesca global.
  if (process.env.ENABLE_REMINDERS === '1') return [];
  const settings = await db.select({ tenantId: clientSettings.tenantId, chatConfig: clientSettings.chatConfig }).from(clientSettings);
  const flagged = settings
    .filter((s) => (s.chatConfig as Record<string, unknown> | null)?.reminders === true)
    .map((s) => s.tenantId);
  const early = tenantMeta.filter((t) => wantsEarlyPush(t.slug)).map((t) => t.id);
  return [...new Set([...flagged, ...early])];
}

export async function runReminders(): Promise<{ scanned: number; sent: number }> {
  const cutoff = new Date(Date.now() - 3 * 3600 * 1000); // solo sesiones recientes
  const tenantMeta = await db.select({ id: tenants.id, slug: tenants.slug }).from(tenants);
  const only = await reminderTenantIds(tenantMeta);
  if (process.env.ENABLE_REMINDERS !== '1' && !only.length) return { scanned: 0, sent: 0 };
  const rows = await db
    .select()
    .from(chatSessions)
    .where(and(
      notInArray(chatSessions.step, ['done', 'closed', 'no_cargo']),
      gt(chatSessions.updatedAt, cutoff),
      ...(only.length ? [inArray(chatSessions.tenantId, only)] : []),
    ))
    .limit(300);

  let sent = 0;
  for (const s of rows) {
    const data = (s.data ?? {}) as Record<string, unknown>;
    const msgs = (s.messages ?? []) as Msg[];
    // Último mensaje real (no el propio seguimiento). Colgado = lo mandamos
    // nosotros (bot u operador) y el cliente no contestó.
    let lastReal: Msg | undefined;
    for (let i = msgs.length - 1; i >= 0; i--) { if (!msgs[i].n) { lastReal = msgs[i]; break; } }
    if (!lastReal || lastReal.from === 'user') continue;

    const lastAt = lastReal.at < 1e12 ? lastReal.at * 1000 : lastReal.at;
    const quietMin = (Date.now() - lastAt) / 60000;
    if (quietMin < QUIET_MIN) continue;
    if (data.reminderForAt === lastReal.at) continue; // ya le hicimos seguimiento a ESTE mensaje

    const text = NUDGES[Math.floor(Math.random() * NUDGES.length)];
    const newMsg = { from: 'bot' as const, text, at: Date.now(), n: true };
    await appendChatMessages(s.id, [newMsg], { dataMerge: { reminderForAt: lastReal.at, reminderSent: true } });
    sent++;
  }
  return { scanned: rows.length, sent };
}

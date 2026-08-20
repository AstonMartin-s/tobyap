import { and, gt, notInArray } from 'drizzle-orm';
import { db } from '@/db';
import { chatSessions } from '@/db/schema';
import { appendChatMessages } from '@/lib/chat/mutations';

// Recontacto automático: UN solo mensajito corto por chat. Si desde nuestro
// último mensaje el cliente no contesta en ~10 min, le mandamos un empujoncito
// breve ("¿seguís por ahí?"). Una vez por chat — nunca se repite. No manda CBU
// ni links (eso ya está en la conversación); solo reengancha.

type Msg = { from: string; text?: string; image?: string; at: number; n?: boolean; op?: boolean };

const QUIET_MIN = 5; // minutos de silencio antes del recontacto

// Mensajitos cortos, rotamos uno al azar para que no sea siempre igual.
const NUDGES = [
  '¿Seguís por ahí? 👀 Cuando quieras seguimos 🎁',
  '¿Todo bien? Avisame y terminamos tu bono 🎁',
  '¡Seguimos cuando puedas! Tu bono sigue reservado 👌',
  '¿Retomamos? Estás a un paso 🎁',
];

export async function runReminders(): Promise<{ scanned: number; sent: number }> {
  const cutoff = new Date(Date.now() - 3 * 3600 * 1000); // solo sesiones recientes
  const rows = await db
    .select()
    .from(chatSessions)
    .where(and(notInArray(chatSessions.step, ['done', 'closed', 'no_cargo']), gt(chatSessions.updatedAt, cutoff)))
    .limit(300);

  let sent = 0;
  for (const s of rows) {
    const data = (s.data ?? {}) as Record<string, unknown>;
    if (data.reminderSent) continue; // UNA sola vez por chat

    const msgs = (s.messages ?? []) as Msg[];
    // Último mensaje "real" (no recontacto).
    let lastReal: Msg | undefined;
    for (let i = msgs.length - 1; i >= 0; i--) { if (!msgs[i].n) { lastReal = msgs[i]; break; } }
    if (!lastReal || lastReal.from === 'user') continue; // no hablamos último / el cliente ya contestó
    if (lastReal.op) continue; // el OPERADOR ya está atendiendo a mano — no lo pisamos con un recordatorio automático

    const quietMin = (Date.now() - lastReal.at) / 60000;
    if (quietMin < QUIET_MIN) continue;

    const text = NUDGES[Math.floor(Math.random() * NUDGES.length)];
    const newMsg = { from: 'bot' as const, text, at: Date.now(), n: true };
    // Append atómico: no pisa un mensaje que el cliente/operador escriba justo ahora.
    await appendChatMessages(s.id, [newMsg], { dataMerge: { reminderSent: true } });
    sent++;
  }
  return { scanned: rows.length, sent };
}

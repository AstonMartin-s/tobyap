import { and, gt, notInArray } from 'drizzle-orm';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { chatSessions } from '@/db/schema';

// Recordatorios automáticos: si desde nuestro último mensaje el cliente NO
// contesta, le mandamos hasta 3 "empujoncitos" (a los 5, 15 y 30 min). Si el
// cliente escribe cualquier cosa, el ciclo se corta solo (el último mensaje real
// pasa a ser suyo). Los recordatorios se marcan con n:true para no contarlos como
// "último mensaje" ni reiniciar el reloj.

type Msg = { from: string; text?: string; image?: string; at: number; n?: boolean; copy?: string };

const TIERS = [5, 15, 30]; // minutos

// Recordatorio según el paso. OBJETIVO: incitar a CARGAR y mantener a la persona
// EN EL CHAT — sin redirigir (nada de portal/walink). El CBU sí va (es lo que
// necesitan para pagar) pero SIEMPRE en su propio mensaje con botón de copiar.
// El redirect a soporte solo ocurre si el cliente lo pide, no acá.
function nudgeMsgs(tier: number, step: string, data: Record<string, unknown>): Msg[] {
  const t = Date.now();
  const m = (text: string, extra?: Partial<Msg>): Msg => ({ from: 'bot', text, at: t, n: true, ...extra });
  const cbu = (data.cbu as string) || '';
  const titular = (data.titular as string) || '';
  const esperandoPago = step === 'comprobante' || step === 'cbu';

  if (esperandoPago) {
    const intro = tier === 5
      ? '🎁 *¡Tu regalo te espera!* Estás a un pasito de tu bono.'
      : tier === 15
        ? '👀 ¿Seguís ahí? Tu *20%* sigue reservado. Aprovechá ahora 👇'
        : '⏰ *Última:* tu bonificación está por vencer. Hacé tu carga y no la pierdas 🎁';
    if (!cbu) {
      return [m(`${intro}\nCargás desde *$1.000* y se te suma *20%* 🎁 Cuando transfieras, mandame el *comprobante* 📸 acá y te acredito.`)];
    }
    // CBU SIEMPRE solo, en su propio mensaje copiable.
    return [
      m(`${intro}\n🏦 Titular: *${titular}*`),
      m(cbu, { copy: cbu }),
      m('Cargás desde *$1.000* y se te suma *20%* 🎁 Cuando transfieras, mandame el *comprobante* 📸 acá y te acredito al toque.'),
    ];
  }

  // Bienvenida / credenciales: empujamos a avanzar, SIN links ni CBU.
  if (tier === 5) return [m('🎁 *¡Tu regalo te espera!* Estás a un pasito de tu bono del *20%*. Seguí por acá y lo reclamás en 1 minuto 👇 Escribime *listo* y te ayudo.')];
  if (tier === 15) return [m('👀 ¿Seguís por acá? Tu bono del *20%* sigue reservado. Terminá de crear tu cuenta y reclamalo 🎁 Escribime y seguimos.')];
  return [m('⏰ *Última:* tu bonificación del *20%* está por vencer. Respondeme por acá y la activamos juntos 🎁')];
}

export async function runReminders(): Promise<{ scanned: number; sent: number }> {
  const cutoff = new Date(Date.now() - 2 * 3600 * 1000); // solo sesiones recientes
  const rows = await db
    .select()
    .from(chatSessions)
    .where(and(notInArray(chatSessions.step, ['done', 'closed', 'no_cargo']), gt(chatSessions.updatedAt, cutoff)))
    .limit(300);

  let sent = 0;
  for (const s of rows) {
    const msgs = (s.messages ?? []) as Msg[];
    // Último mensaje "real" (no recordatorio).
    let lastReal: Msg | undefined;
    for (let i = msgs.length - 1; i >= 0; i--) { if (!msgs[i].n) { lastReal = msgs[i]; break; } }
    if (!lastReal || lastReal.from === 'user') continue; // el cliente ya contestó / no hay de qué

    const anchor = lastReal.at;
    const quietMin = (Date.now() - anchor) / 60000;
    const data = (s.data ?? {}) as Record<string, unknown>;
    const anchorChanged = data.reminderAnchor !== anchor;
    const already: number[] = anchorChanged ? [] : ((data.remindersSent as number[]) ?? []);

    const due = TIERS.filter((t) => quietMin >= t && !already.includes(t));
    if (!due.length) continue;
    const tier = due[0]; // uno por corrida (el más chico pendiente)

    const newMsgs = nudgeMsgs(tier, s.step ?? '', data);
    const messages = [...msgs, ...newMsgs] as unknown as (typeof chatSessions.$inferSelect)['messages'];
    await db.update(chatSessions).set({
      messages,
      data: { ...data, remindersSent: [...already, tier], reminderAnchor: anchor },
      updatedAt: new Date(),
    }).where(eq(chatSessions.id, s.id));
    sent++;
  }
  return { scanned: rows.length, sent };
}

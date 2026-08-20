// Smoke de CONCURRENCIA (Fase A/B): valida que las escrituras atómicas de
// chat_sessions NO pierden datos cuando varios escritores pegan a la vez
// (operario + supervisor + scheduler). Crea UNA fila de prueba, dispara N
// escrituras concurrentes, verifica que llegaron todas y la BORRA al final.
//
// Impacto en DB: una sola fila efímera (sessionKey `smoke-concurrency-*`) que se
// elimina siempre (incluso ante error). No toca datos de clientes.
//
// Correr: npm run smoke:concurrency

import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { chatSessions, tenants } from '@/db/schema';
import { appendChatMessages, mergeChatData } from '@/lib/chat/mutations';

let failed = 0;
function check(name: string, cond: boolean, extra = '') {
  console.log(`${cond ? 'OK  ' : 'FAIL'} · ${name}${extra ? ' · ' + extra : ''}`);
  if (!cond) failed++;
}

const N = 25; // escritores concurrentes

async function main() {
  const [t] = await db.select({ id: tenants.id, slug: tenants.slug }).from(tenants).limit(1);
  if (!t) throw new Error('no hay tenant para el smoke');

  const sessionKey = `smoke-concurrency-${Date.now()}`;
  const [row] = await db
    .insert(chatSessions)
    .values({ tenantId: t.id, sessionKey, step: 'welcome', messages: [], data: {} })
    .returning({ id: chatSessions.id });
  const id = row.id;
  console.log(`fila de prueba: ${sessionKey} (tenant ${t.slug})`);

  try {
    // 1) N appends de 1 mensaje cada uno, TODOS en paralelo. Si hubiera
    //    read-modify-write en JS, la mayoría se pisaría y quedarían <N.
    await Promise.all(
      Array.from({ length: N }, (_, i) =>
        appendChatMessages(id, [{ from: 'bot', text: `msg-${i}`, at: Date.now() + i }]),
      ),
    );
    const [afterAppend] = await db
      .select({ messages: chatSessions.messages })
      .from(chatSessions)
      .where(eq(chatSessions.id, id));
    const count = (afterAppend?.messages ?? []).length;
    check(`append concurrente conserva los ${N} mensajes`, count === N, `quedaron ${count}`);

    // 2) N merges de data con CLAVES DISTINTAS en paralelo. Todas deben persistir.
    await Promise.all(
      Array.from({ length: N }, (_, i) => mergeChatData(id, { [`k${i}`]: i })),
    );
    const [afterMerge] = await db
      .select({ data: chatSessions.data })
      .from(chatSessions)
      .where(eq(chatSessions.id, id));
    const data = (afterMerge?.data ?? {}) as Record<string, unknown>;
    const keysOk = Array.from({ length: N }, (_, i) => data[`k${i}`] === i).every(Boolean);
    check(`merge concurrente conserva las ${N} claves`, keysOk, `claves ${Object.keys(data).length}`);

    // 3) Merge no pisa mensajes ni viceversa (aislamiento de columnas).
    const [both] = await db
      .select({ messages: chatSessions.messages, data: chatSessions.data })
      .from(chatSessions)
      .where(eq(chatSessions.id, id));
    check('merge de data no borró mensajes', (both?.messages ?? []).length === N);
  } finally {
    await db.delete(chatSessions).where(eq(chatSessions.id, id));
    console.log('fila de prueba borrada');
  }

  console.log(failed === 0 ? '\nsmoke:concurrency VERDE' : `\nsmoke:concurrency ROJO (${failed} fallos)`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

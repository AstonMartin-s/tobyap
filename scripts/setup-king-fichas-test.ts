/**
 * Habilita modo prueba "fichas gratis" para teléfonos específicos en King.
 * No cambia el guion del resto de leads (siguen con la config tenant actual).
 *
 * Uso:
 *   tsx --env-file=.env scripts/setup-king-fichas-test.ts
 *   tsx --env-file=.env scripts/setup-king-fichas-test.ts --phone 3541370465 --fichas 50000
 */
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { chatSessions, clientSettings } from '@/db/schema';
import { welcomeStep } from '@/lib/chat/flow';
import { loadChatRuntime } from '@/lib/chat/loadRuntime';
import { normalizeAr } from '@/lib/chat/wachecker';
import { getTenantBySlug } from '@/lib/tenants';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function main() {
  const rawPhone = arg('--phone', '3541370465');
  const fichas = Number(arg('--fichas', '50000'));
  const minDeposit = Number(arg('--min', '1000'));
  const phone = normalizeAr(rawPhone);

  const tenant = await getTenantBySlug('king');
  if (!tenant) throw new Error('tenant king no encontrado');

  const [row] = await db.select().from(clientSettings).where(eq(clientSettings.tenantId, tenant.id)).limit(1);
  const prev = (row?.chatConfig ?? {}) as Record<string, unknown>;
  const testPhones = Array.isArray(prev.testPhones) ? [...prev.testPhones.map(String)] : [];
  if (!testPhones.includes(phone)) testPhones.push(phone);

  const next = {
    ...prev,
    testPhones,
    testRuntime: {
      offerType: 'fichas',
      offerValue: fichas,
      minDeposit,
    },
  };

  await db
    .insert(clientSettings)
    .values({ tenantId: tenant.id, chatConfig: next })
    .onConflictDoUpdate({ target: clientSettings.tenantId, set: { chatConfig: next, updatedAt: new Date() } });

  console.log('OK chat_config test mode:', JSON.stringify({ testPhones, testRuntime: next.testRuntime }));

  const [existing] = await db
    .select()
    .from(chatSessions)
    .where(and(eq(chatSessions.tenantId, tenant.id), eq(chatSessions.phone, phone)))
    .limit(1);

  const runtime = await loadChatRuntime(tenant.id, tenant.name, phone);
  console.log('Runtime efectivo para este tel:', {
    offerType: runtime.offerType,
    offerValue: runtime.offerValue,
    minDeposit: runtime.minDeposit,
  });

  if (existing) {
    const w = welcomeStep(existing.name, runtime);
    const botMsgs = w.messages.map((m) => ({ from: 'bot' as const, text: m.text, at: m.at }));
    await db
      .update(chatSessions)
      .set({
        step: 'welcome',
        messages: botMsgs,
        data: { ...(existing.data as object ?? {}), unread: false, archived: false, testFichas: true },
        updatedAt: new Date(),
      })
      .where(eq(chatSessions.id, existing.id));
    console.log(`Sesión reseteada (${existing.sessionKey}) → welcome con guion fichas.`);
    console.log(`Chat: https://chat.fichaslibres.online/chat/king`);
  } else {
    console.log('No había sesión previa; al iniciar chat con ese teléfono entra directo con fichas gratis.');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

import { db } from '@/db';
import { chatSessions } from '@/db/schema';
import { getTenantBySlug } from '@/lib/tenants';

// Smoke para Luis (ElGanador): deja un chat en validando, campaña Test
// (no suma KPIs, no dispara Meta al acreditar). El operador toca Cargo y
// carga 4500 para ver el recuadro del monto.
//
//   npx tsx --env-file=.env scripts/smoke-elganador-cargo.ts

const TEXT = 'Hola smokeTest pasar a cargo y colocar valor 4500.';

async function main() {
  const capturedAt = new Date().toISOString();
  console.log('SMOKE DATES (previo a insert):', capturedAt);

  const tenant = await getTenantBySlug('elganador');
  if (!tenant) throw new Error('no tenant elganador');

  const now = Date.now();
  const sessionKey = `smoke-elganador-${now.toString(36)}`;
  const messages = [
    { from: 'bot' as const, text: 'Un gusto atenderte. Este es un smoke de panel (no va a Meta).', at: now - 90_000 },
    { from: 'user' as const, text: TEXT, at: now },
  ];

  await db.insert(chatSessions).values({
    tenantId: tenant.id,
    sessionKey,
    phone: '549110004500',
    name: 'smokeTest',
    campaign: 'Test',
    step: 'validando',
    kommoLeadId: null,
    data: {
      unread: true,
      unreadCount: 1,
      smokeTest: true,
      smokeCapturedAt: capturedAt,
      smokeHintAmount: 4500,
    },
    messages,
    updatedAt: new Date(),
  });

  console.log({
    slug: 'elganador',
    name: 'smokeTest',
    campaign: 'Test',
    step: 'validando',
    sessionKey,
    capturedAt,
    insertedAt: new Date().toISOString(),
    text: TEXT,
    hint: 'Inbox → buscar smokeTest → Cargo → 4500',
  });
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });

import { db } from '@/db';
import { tenants } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { invalidateTenant } from '@/lib/tenants';

// Setea customFields.conversation_value_ars (valor esperado por chat, en ARS)
// para el evento ConversacionCRM. Calculado ~ carga_promedio × tasa_conversión.
// Ajustable a mano cuando haya más data.
//
// Uso:
//   npx tsx --env-file=.env scripts/set-conversation-value.ts
//   npx tsx --env-file=.env scripts/set-conversation-value.ts bblack 800

const DEFAULTS: Record<string, number> = {
  bblack: 800,   // 3703 × 21.6%
  king: 350,     // 2500 × 13.4%
  paradise: 400, // provisorio (poca data)
};

async function setOne(slug: string, value: number) {
  const [t] = await db.select().from(tenants).where(eq(tenants.slug, slug));
  if (!t) { console.log(`skip ${slug}: no existe`); return; }
  const cf = { ...(t.customFields as Record<string, number>), conversation_value_ars: value };
  await db.update(tenants).set({ customFields: cf, updatedAt: new Date() }).where(eq(tenants.id, t.id));
  invalidateTenant(slug);
  console.log(`✓ ${slug}: conversation_value_ars = ${value} ARS`);
}

async function main() {
  const [slug, valueStr] = process.argv.slice(2);
  if (slug && valueStr) {
    await setOne(slug, Number(valueStr));
  } else {
    for (const [s, v] of Object.entries(DEFAULTS)) await setOne(s, v);
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });

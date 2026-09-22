import { and, eq, ne } from 'drizzle-orm';
import { db } from '../db';
import { landings, numbers } from '../db/schema';
import { getTenantBySlug, invalidateTenant, upsertTenant } from '../lib/tenants';

// Cliente de Sender: sin pixel ni CAPI. Un link rota 1 a 1 entre los WhatsApp
// de atención después de la plantilla y la respuesta afirmativa.
const SLUG = 'sender-wa';
const ALIAS = 'sigue';
const PHONES = [
  '5491164675373',
  '5491164675351',
  '5491168043891',
  '5491155634024',
  '5491157437044',
  '5491171513674',
];

async function main() {
  const taken = await db.select({ id: landings.id }).from(landings).where(eq(landings.alias, ALIAS)).limit(1);
  const existing = await getTenantBySlug(SLUG);
  if (taken.length && !existing) throw new Error(`alias /l/${ALIAS} ya está usado`);

  const row = await upsertTenant({
    slug: SLUG,
    name: 'Sender',
    role: 'redirect',
    provider: 'manual',
    readonly: true,
    niche: 'circo',
  });

  await db.delete(numbers).where(eq(numbers.tenantId, row.id));
  const base = Date.now();
  for (let i = 0; i < PHONES.length; i++) {
    await db.insert(numbers).values({
      tenantId: row.id,
      name: `WA ${i + 1}`,
      phone: PHONES[i],
      type: 'soporte',
      status: true,
      createdAt: new Date(base + i * 1000),
    });
  }

  const config = {
    waNumber: '',
    useFixedNumber: false,
    noCode: true,
    pixelId: '',
    message: 'Hola',
    brandName: 'WhatsApp',
    neutralPreview: true,
    headline: 'Te redirigimos a WhatsApp…',
    subtext: '',
    redirectDelayMs: 800,
  };
  const [lp] = await db
    .select({ id: landings.id, tenantId: landings.tenantId })
    .from(landings)
    .where(eq(landings.alias, ALIAS))
    .limit(1);
  if (lp && lp.tenantId !== row.id) throw new Error(`alias /l/${ALIAS} pertenece a otro cliente`);
  const values = {
    tenantId: row.id,
    landingSlug: 'wa',
    alias: ALIAS,
    name: 'Redirect WhatsApp',
    type: 'soporte',
    active: true,
    config,
    updatedAt: new Date(),
  };
  if (lp) await db.update(landings).set(values).where(eq(landings.id, lp.id));
  else await db.insert(landings).values(values);

  const foreign = await db
    .select({ id: landings.id })
    .from(landings)
    .where(and(eq(landings.alias, ALIAS), ne(landings.tenantId, row.id)));
  if (foreign.length) throw new Error('alias duplicado');

  invalidateTenant(SLUG);
  console.log(`https://go.fichaslibres.online/l/${ALIAS}`);
  console.log('numeros', PHONES.length);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

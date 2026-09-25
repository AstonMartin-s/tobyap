import { and, eq } from 'drizzle-orm';
import { db } from '../db';
import { landings, numbers } from '../db/schema';
import { getTenantBySlug, invalidateTenant } from '../lib/tenants';

// Landing de pauta PiliKing: promo Triplica (A300 = 200%) y rotación 1 a 1
// entre dos WhatsApp. No toca el soporte walink (ese sigue fijo en numero1).
// La URL vieja /duplica se renombra a /triplica (Pili triplica la carga, no duplica).
const SLUG = 'piliking';
const LANDING = 'triplica';
const OLD_LANDING = 'duplica';
const TYPE = 'triplica';
const PHONES = [
  { name: 'duplica-1', local: '1176506098', phone: '5491176506098' },
  { name: 'duplica-2', local: '1178292653', phone: '5491178292653' },
];

async function main() {
  const t = await getTenantBySlug(SLUG);
  if (!t) throw new Error('no tenant piliking');

  const base = Date.now();
  for (let i = 0; i < PHONES.length; i++) {
    const p = PHONES[i];
    const [existing] = await db
      .select({ id: numbers.id })
      .from(numbers)
      .where(and(eq(numbers.tenantId, t.id), eq(numbers.phone, p.phone), eq(numbers.type, TYPE)))
      .limit(1);
    if (existing) {
      await db.update(numbers).set({ name: p.name, status: true }).where(eq(numbers.id, existing.id));
    } else {
      await db.insert(numbers).values({
        tenantId: t.id,
        name: p.name,
        phone: p.phone,
        type: TYPE,
        status: true,
        createdAt: new Date(base + i * 1000),
      });
    }
  }

  const config = {
    waNumber: '',
    useFixedNumber: false,
    noCode: false,
    pixelId: t.metaPixelId ?? '',
    message: 'Hola, quiero mi promo Triplica',
    brandName: 'PiliKing',
    primaryColor: '#B8860B',
    headline: 'Un segundo…',
    subtext: 'Te estamos conectando con tu promo Triplica',
    ccpp: 'A300',
    campaign: '',
    redirectDelayMs: 1200,
  };

  // Si todavía existe la landing vieja "duplica", la renombramos a "triplica".
  const [old] = await db
    .select({ id: landings.id })
    .from(landings)
    .where(and(eq(landings.tenantId, t.id), eq(landings.landingSlug, OLD_LANDING)))
    .limit(1);
  if (old) {
    await db.update(landings).set({ landingSlug: LANDING, updatedAt: new Date() }).where(eq(landings.id, old.id));
  }
  const [lp] = await db
    .select({ id: landings.id })
    .from(landings)
    .where(and(eq(landings.tenantId, t.id), eq(landings.landingSlug, LANDING)))
    .limit(1);
  if (lp) {
    await db.update(landings).set({ name: 'PiliKing Triplica', type: TYPE, active: true, config, updatedAt: new Date() }).where(eq(landings.id, lp.id));
  } else {
    await db.insert(landings).values({
      tenantId: t.id,
      landingSlug: LANDING,
      name: 'PiliKing Triplica',
      type: TYPE,
      active: true,
      config,
    });
  }

  invalidateTenant(SLUG);
  console.log('https://go.fichaslibres.online/l/piliking/triplica');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });

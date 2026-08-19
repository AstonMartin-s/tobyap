// Smoke contra el cableado REAL: código de ESTA rama + DB en SOLO LECTURA.
// No llama emitCargo (eso pegaría Meta/Kommo). No inserta ni updatea.
// No pega a Railway: el resolve se prueba importando el handler (Fase 2 aún no está en prod).
// Correr: npm run smoke:db

import { NextRequest } from 'next/server';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { attributions, metaEvents, tenants } from '@/db/schema';
import { eventExistsAny } from '@/lib/meta';
import { cargoEventId } from '@/lib/cargo/emit';
import { GET as resolveGet } from '@/app/api/v1/resolve/route';

let failed = 0;
function check(name: string, cond: boolean, extra = '') {
  console.log(`${cond ? 'OK  ' : 'FAIL'} · ${name}${extra ? ' · ' + extra : ''}`);
  if (!cond) failed++;
}

async function pickTenant() {
  const rows = await db
    .select({ slug: tenants.slug, name: tenants.name, id: tenants.id, active: tenants.active, readonly: tenants.readonly })
    .from(tenants);
  console.log('tenants:', rows.map((r) => `${r.slug}${r.active ? '' : ' (off)'}${r.readonly ? ' ro' : ''}`).join(', ') || '(ninguno)');
  const withCargo = await db
    .select({ tenantId: metaEvents.tenantId, n: sql<number>`count(*)::int` })
    .from(metaEvents)
    .where(and(eq(metaEvents.eventType, 'cargo'), eq(metaEvents.status, 'sent')))
    .groupBy(metaEvents.tenantId);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const ranked = withCargo
    .map((c) => ({ ...c, t: byId.get(c.tenantId) }))
    .filter((x) => x.t?.active)
    .sort((a, b) => {
      const aKing = a.t!.slug === 'king' ? 1 : 0;
      const bKing = b.t!.slug === 'king' ? 1 : 0;
      return aKing - bKing || b.n - a.n;
    });
  const chosen = ranked[0]?.t ?? rows.find((r) => r.active);
  if (!chosen) throw new Error('no hay tenant activo');
  console.log(`usando tenant: ${chosen.slug} (solo lectura, no King si hay otro con cargas)`);
  return chosen;
}

async function smokeCargo(tenant: { id: string; slug: string }) {
  const dups = await db
    .select({ eventId: metaEvents.eventId, n: sql<number>`count(*)::int` })
    .from(metaEvents)
    .where(and(eq(metaEvents.tenantId, tenant.id), eq(metaEvents.eventType, 'cargo')))
    .groupBy(metaEvents.eventId)
    .having(sql`count(*) > 1`);
  check('cero event_id cargo duplicados', dups.length === 0, dups.length ? `${dups.length} ids` : 'ok');

  const [sample] = await db
    .select({ eventId: metaEvents.eventId })
    .from(metaEvents)
    .where(and(eq(metaEvents.tenantId, tenant.id), eq(metaEvents.eventType, 'cargo'), eq(metaEvents.status, 'sent')))
    .limit(1);

  if (!sample) {
    console.log('SKIP · no hay cargo sent en este tenant');
    return;
  }
  check('eventExistsAny ve un cargo ya sent', await eventExistsAny(tenant.id, [sample.eventId]));
  const fake = cargoEventId({ kommoLeadId: 9_000_000_001 });
  check('eventExistsAny no inventa un lead fake', !(await eventExistsAny(tenant.id, [fake])));
}

async function callResolve(path: string, headers: Record<string, string> = {}) {
  const req = new NextRequest(`http://smoke.local${path}`, { headers });
  const res = await resolveGet(req);
  return res.status;
}

async function smokeResolve(tenantSlug: string) {
  const prevKey = process.env.RESOLVE_API_KEY;
  const prevRequire = process.env.REQUIRE_RESOLVE_CLIENT;
  process.env.RESOLVE_API_KEY = 'smoke-local-key';
  process.env.REQUIRE_RESOLVE_CLIENT = '0';

  try {
    const noKey = await callResolve('/api/v1/resolve?code=SMOKE_NO_SUCH');
    check('resolve sin key → 401', noKey === 401, `status ${noKey}`);

    const headers = { Authorization: 'Bearer smoke-local-key' };
    const missing = await callResolve('/api/v1/resolve?code=SMOKE_NO_SUCH', headers);
    check('resolve con key y code inexistente → 404', missing === 404, `status ${missing}`);

    const [attr] = await db
      .select({ code: attributions.code })
      .from(attributions)
      .innerJoin(tenants, eq(tenants.id, attributions.tenantId))
      .where(eq(tenants.slug, tenantSlug))
      .limit(1);

    if (!attr) {
      console.log(`SKIP · sin attribution en ${tenantSlug} para ?client=`);
      return;
    }
    const q = encodeURIComponent(attr.code);
    const ok = await callResolve(`/api/v1/resolve?code=${q}&client=${encodeURIComponent(tenantSlug)}`, headers);
    check('resolve ?client= correcto → 200', ok === 200, `status ${ok}`);
    const wrong = await callResolve(`/api/v1/resolve?code=${q}&client=smoke-no-existe`, headers);
    check('resolve ?client= ajeno → 404', wrong === 404, `status ${wrong}`);
    const noClient = await callResolve(`/api/v1/resolve?code=${q}`, headers);
    check('resolve sin ?client= sigue 200 (flag off)', noClient === 200, `status ${noClient}`);
  } finally {
    if (prevKey === undefined) delete process.env.RESOLVE_API_KEY;
    else process.env.RESOLVE_API_KEY = prevKey;
    if (prevRequire === undefined) delete process.env.REQUIRE_RESOLVE_CLIENT;
    else process.env.REQUIRE_RESOLVE_CLIENT = prevRequire;
  }
}

async function main() {
  const t = await pickTenant();
  await smokeCargo(t);
  await smokeResolve(t.slug);
  console.log(failed === 0 ? '\nsmoke:db VERDE' : `\nsmoke:db ROJO (${failed} fallos)`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

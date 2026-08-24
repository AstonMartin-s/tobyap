import { getTenantBySlug } from '@/lib/tenants';
import { sendCapiEvent } from '@/lib/meta';

// Prueba controlada del evento Cargo con value/currency contra Meta Test Events.
//
// Uso:
//   META_TEST_EVENT_CODE=TEST12345 npx tsx scripts/test-cargo-capi.ts paradise 5000
//
// - Manda un evento Cargo SINTÉTICO (event_id único test-cargo-<ts>) al pixel del
//   tenant, con value=<monto> y currency=ARS.
// - NO toca Kommo, NO mueve leads, NO marca conversiones reales.
// - Al setear META_TEST_EVENT_CODE, el evento aparece SOLO en la pestaña
//   "Probar eventos" de Meta (no cuenta como conversión real).
// - Verificá en Events Manager → Probar eventos que el evento traiga
//   value=<monto> y currency=ARS.

async function main() {
  const slug = process.argv[2] ?? 'paradise';
  const value = Number(process.argv[3] ?? 5000);
  const code = process.env.META_TEST_EVENT_CODE;

  if (!code) throw new Error('Falta META_TEST_EVENT_CODE en el entorno (Events Manager → Probar eventos)');
  if (!Number.isFinite(value) || value <= 0) throw new Error('monto (value) inválido');

  const tenant = await getTenantBySlug(slug);
  if (!tenant) throw new Error(`tenant ${slug} no existe`);
  if (!tenant.metaPixelId || !tenant.metaCapiToken) throw new Error(`tenant ${slug} sin pixel/token de Meta`);

  const eventId = `test-cargo-${Date.now()}`;
  console.log(`→ Enviando Cargo de prueba: tenant=${slug} pixel=${tenant.metaPixelId} value=${value} ARS eventId=${eventId} testCode=${code}`);

  const res = await sendCapiEvent(tenant, {
    eventName: 'Cargo',
    eventId,
    userData: {
      // Datos sintéticos mínimos para que Meta acepte el evento de prueba.
      phone: '5491100000000',
      fbp: `fb.1.${Date.now()}.1234567890`,
      fbc: `fb.1.${Date.now()}.TESTfbclid`,
    },
    customData: {
      internal_event: 'CargoCRM',
      cargo_source: 'test-script',
      value,
      currency: 'ARS',
    },
    eventSourceUrl: 'https://go.fichaslibres.online/test',
  });

  console.log('← Respuesta Meta:', JSON.stringify(res, null, 2));
  console.log(res.ok ? '✓ Enviado. Revisá "Probar eventos" en Events Manager.' : '✗ Falló, ver body arriba.');
  process.exit(res.ok ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });

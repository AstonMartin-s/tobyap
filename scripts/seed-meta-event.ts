// Envía UN evento semilla bien formado a Meta CAPI para registrar/activar el
// evento en el Administrador de eventos, SIN tocar metaEvents (no se mezcla en
// el TrackerIO). Uso puntual para que el evento aparezca en el selector del ad set.
//   npm run seed-meta -- <slug> <EventName>
//   ej: npm run seed-meta -- ClienteA1 ConversacionCRMA1
import crypto from 'crypto';
import { getTenantBySlug } from '@/lib/tenants';

const GRAPH = 'v21.0';

function sha256(v: string) { return crypto.createHash('sha256').update(v).digest('hex'); }

async function main() {
  const slug = process.argv[2];
  const eventName = process.argv[3];
  if (!slug || !eventName) { console.error('Uso: npm run seed-meta -- <slug> <EventName>'); process.exit(1); }
  const t = await getTenantBySlug(slug);
  if (!t?.metaPixelId || !t?.metaCapiToken) { console.error('tenant sin pixel/token'); process.exit(1); }

  const ts = Math.floor(Date.now() / 1000);
  const event = {
    event_name: eventName,
    event_time: ts,
    event_id: `seed-${Date.now()}`,
    action_source: 'website',
    event_source_url: 'https://go.fichaslibres.online/l/' + slug,
    user_data: {
      // Teléfono dummy hasheado (no es de nadie real): solo para que el evento
      // vaya "bien formado" con user_data. Match bajo, no importa para registrar.
      ph: [sha256('5490000000000')],
      fbp: `fb.1.${Date.now()}.${Math.floor(Math.random() * 1e16)}`,
      fbc: `fb.1.${Date.now()}.seed${Math.floor(Math.random() * 1e10)}`,
    },
    custom_data: { value: 1, currency: 'USD', campaign_id: 'C1', internal_event: 'seed' },
  };

  const res = await fetch(`https://graph.facebook.com/${GRAPH}/${t.metaPixelId}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: [event], access_token: t.metaCapiToken }),
  });
  const body = await res.json().catch(() => ({}));
  console.log('pixel:', t.metaPixelId, '| event:', eventName, '| event_id:', event.event_id);
  console.log('HTTP', res.status, '->', JSON.stringify(body));
  process.exit(res.ok ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });

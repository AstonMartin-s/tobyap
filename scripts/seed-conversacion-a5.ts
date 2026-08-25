import crypto from 'crypto';
import { getTenantBySlug } from '@/lib/tenants';
import { fullEventName, conversationValue } from '@/lib/meta';

// Empuja N eventos ConversacionCRMA5 al pixel de paradise para que Meta lo
// registre y sea seleccionable como conversión personalizada al lanzar.
// NO persiste en meta_events (no ensucia reportes internos): va directo al Graph.
//
// Uso: npx tsx --env-file=.env scripts/seed-conversacion-a5.ts [slug] [n]

const GRAPH = 'https://graph.facebook.com/v21.0';

async function main() {
  const slug = process.argv[2] || 'paradise';
  const n = Number(process.argv[3] || 15);
  const tenant = await getTenantBySlug(slug);
  if (!tenant) throw new Error(`tenant ${slug} no existe`);
  if (!tenant.metaPixelId || !tenant.metaCapiToken) throw new Error('sin pixel/token');

  const eventName = fullEventName('Conversacion', tenant);
  const val = conversationValue(tenant);
  const now = Math.floor(Date.now() / 1000);

  const data = Array.from({ length: n }, (_, i) => ({
    event_name: eventName,
    event_time: now - i * 60, // escalonados en el último rato
    event_id: `seed-convA5-${now}-${i}`,
    action_source: 'website',
    event_source_url: `https://go.fichaslibres.online/l/${slug}`,
    user_data: {
      // fbp sintético válido en formato; suficiente para que Meta acepte el evento.
      fbp: `fb.1.${Date.now()}.${Math.floor(Math.random() * 1e10)}`,
      client_user_agent: 'Mozilla/5.0 (seed) TrackerIO',
    },
    custom_data: { internal_event: 'ConversacionCRM', seed: true, ...val },
  }));

  const res = await fetch(`${GRAPH}/${tenant.metaPixelId}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data, access_token: tenant.metaCapiToken }),
  });
  const body = await res.json().catch(() => ({}));
  console.log('status', res.status);
  console.log('event_name', eventName, '· value', val);
  console.log(JSON.stringify(body, null, 2));
  process.exit(res.ok ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });

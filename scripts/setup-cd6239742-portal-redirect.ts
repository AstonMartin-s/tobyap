import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { landings } from '@/db/schema';
import { getTenantBySlug } from '@/lib/tenants';

// Cliente 2 (RED VIP, tenant cd6239742): la landing "redvip" deja de redirigir a
// WhatsApp y pasa a redirigir al PORTAL EXTERNO del cliente (Vercel) con el token
// de atribución en la query. El portal inyecta ese code en el primer mensaje de su
// livechat de Kommo → el webhook de TOBYAP matchea la atribución (fbc/fbp/campaign)
// y dispara la conversación a Meta. Aditivo: solo toca la config de esta landing.
//
// Flujo: Meta → /l/cd6239742/redvip (Pixel + token) → portal?code=PB..&campaign=CC1&ccpp=A5
async function main() {
  const t = await getTenantBySlug('cd6239742');
  if (!t) throw new Error('no tenant cd6239742');

  const landingSlug = 'redvip';
  const [existing] = await db
    .select()
    .from(landings)
    .where(and(eq(landings.tenantId, t.id), eq(landings.landingSlug, landingSlug)));
  if (!existing) throw new Error('no existe la landing redvip');

  const prev = (existing.config ?? {}) as Record<string, unknown>;
  const config = {
    ...prev,
    portalUrl: 'https://nuestraspaginas.vercel.app',
    campaign: 'CC1',
    ccpp: 'A5',
  };

  await db.update(landings).set({ config, active: true }).where(eq(landings.id, existing.id));
  console.log('landing redvip → portalUrl:', config.portalUrl, '| campaign:', config.campaign, '| ccpp:', config.ccpp);
  console.log('URL: https://go.fichaslibres.online/l/cd6239742/redvip');
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

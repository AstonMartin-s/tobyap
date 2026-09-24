import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getTenantBySlug } from '@/lib/tenants';
import { hasWhatsappChannel } from '@/lib/blaster';

export const dynamic = 'force-dynamic';

// GET /api/panel/features — solapas opcionales habilitadas para el tenant de la
// sesión. El Nav las usa para mostrar/ocultar pestañas. Default: todo on.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no autorizado' }, { status: 401 });
  const tenant = await getTenantBySlug(session.slug);
  const features = tenant?.features ?? { reportes: true, embudo: true, livechat: true, fichas: true };
  const niche = tenant?.niche ?? 'circo';
  const whatsapp = tenant ? hasWhatsappChannel(tenant) : false;
  return NextResponse.json({ features, niche, whatsapp });
}

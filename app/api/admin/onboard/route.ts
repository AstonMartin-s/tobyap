import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { discoverKommoConfig } from '@/lib/kommo-onboard';
import { upsertTenant } from '@/lib/tenants';
import { parseNiche } from '@/lib/niche';
import type { CreateTenantInput } from '@/lib/types';

// Auth: sesión admin O header x-admin-token (para scripts/automatización).
async function authorized(req: NextRequest): Promise<boolean> {
  const session = await getSession();
  if (session?.role === 'admin') return true;
  const token = req.headers.get('x-admin-token');
  return !!token && token === process.env.ADMIN_TOKEN;
}

// POST /api/admin/onboard?preview=true
// Descubre la config de Kommo (pipeline/estados/custom fields por nombre).
// Sin preview, además crea/actualiza el tenant.
export async function POST(req: NextRequest) {
  if (!(await authorized(req))) {
    return NextResponse.json({ error: 'no autorizado' }, { status: 401 });
  }

  const input = (await req.json().catch(() => ({}))) as CreateTenantInput & {
    pipelineName?: string;
    pipelineId?: number;
  };
  if (!input.slug || !input.name) {
    return NextResponse.json({ error: 'slug y name requeridos' }, { status: 400 });
  }

  const niche = parseNiche(input.niche);
  // Kommo se usa si el tenant lo aporta. Es OBLIGATORIO solo en 'circo'
  // (descubrimiento de pipeline/estados/campos). En 'tienda' es opcional: el
  // CRM/panel es nuestro y el trackeo va por pixel + conversión personalizada.
  const hasKommo = !!(input.kommoSubdomain && input.kommoToken);

  if (niche === 'circo' && !hasKommo) {
    return NextResponse.json(
      { error: 'circo requiere kommoSubdomain y kommoToken' },
      { status: 400 },
    );
  }
  if (niche === 'tienda' && !input.metaPixelId) {
    return NextResponse.json(
      { error: 'tienda requiere metaPixelId (y metaCapiToken para disparar eventos)' },
      { status: 400 },
    );
  }

  // Descubrimiento de Kommo: solo si se aportaron credenciales.
  let cfg: Awaited<ReturnType<typeof discoverKommoConfig>> | null = null;
  if (hasKommo) {
    try {
      cfg = await discoverKommoConfig(input.kommoSubdomain!, input.kommoToken!, {
        pipelineName: input.pipelineName,
        pipelineId: input.pipelineId,
      });
    } catch (e) {
      return NextResponse.json({ error: String((e as Error).message) }, { status: 502 });
    }
  }

  // Modo preview: solo devuelve lo descubierto (o el nicho), no crea nada.
  if (req.nextUrl.searchParams.get('preview') === 'true') {
    return NextResponse.json({ ok: true, niche, discovered: cfg });
  }

  const tenantInput: CreateTenantInput = {
    ...input,
    niche,
    kommoPipelineId: input.kommoPipelineId ?? cfg?.pipelineId,
    customFields: { ...(cfg?.customFields ?? {}), ...(input.customFields ?? {}) },
  };

  const row = await upsertTenant(tenantInput);
  return NextResponse.json({
    ok: true,
    tenant: { id: row.id, slug: row.slug },
    niche,
    discovered: cfg,
    webhook: hasKommo ? `/api/webhooks/kommo/${row.slug}` : null,
  });
}

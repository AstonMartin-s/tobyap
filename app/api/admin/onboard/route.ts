import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { discoverKommoConfig } from '@/lib/kommo-onboard';
import { upsertTenant } from '@/lib/tenants';
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
  if (!input.slug || !input.name || !input.kommoSubdomain || !input.kommoToken) {
    return NextResponse.json(
      { error: 'slug, name, kommoSubdomain y kommoToken requeridos' },
      { status: 400 },
    );
  }

  let cfg;
  try {
    cfg = await discoverKommoConfig(input.kommoSubdomain, input.kommoToken, {
      pipelineName: input.pipelineName,
      pipelineId: input.pipelineId,
    });
  } catch (e) {
    return NextResponse.json({ error: String((e as Error).message) }, { status: 502 });
  }

  // Modo preview: solo devuelve lo descubierto, no crea nada.
  if (req.nextUrl.searchParams.get('preview') === 'true') {
    return NextResponse.json({ ok: true, discovered: cfg });
  }

  const tenantInput: CreateTenantInput = {
    ...input,
    kommoPipelineId: input.kommoPipelineId ?? cfg.pipelineId,
    customFields: { ...cfg.customFields, ...(input.customFields ?? {}) },
  };

  const row = await upsertTenant(tenantInput);
  return NextResponse.json({
    ok: true,
    tenant: { id: row.id, slug: row.slug },
    discovered: cfg,
    webhook: `/api/webhooks/kommo/${row.slug}`,
  });
}

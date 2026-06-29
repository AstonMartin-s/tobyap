import { NextRequest, NextResponse } from 'next/server';
import { isAdmin } from '@/lib/admin-auth';
import { provisionClient } from '@/lib/kommo-provision';
import { discoverKommoConfig } from '@/lib/kommo-onboard';
import { upsertTenant } from '@/lib/tenants';
import type { CreateTenantInput } from '@/lib/types';

// Mapea el resultado del provisionador / discover a los customFields que espera
// el tenant (claves canónicas que usa lib/tenants.ts -> resolve()).
function buildCustomFields(
  fields: Record<string, number>,
  statuses: { id: number; name: string }[],
): Record<string, number> {
  const cf: Record<string, number> = {};
  const f = (k: string) => {
    const hit = Object.entries(fields).find(([name]) => name.toLowerCase() === k.toLowerCase());
    return hit?.[1];
  };
  const s = (re: RegExp, not?: RegExp) =>
    statuses.find((x) => re.test(x.name) && (!not || !not.test(x.name)))?.id;

  const map: Record<string, number | undefined> = {
    fbclid: f('fbclid'),
    utm_campaign: f('utm_campaign'),
    utm_source: f('utm_source'),
    utm_content: f('utm_content'),
    cbu_field: f('CBU'),
    titular_field: f('TITULAR'),
    ad_code: f('ad_code'),
    status_cargo: s(/cargo/i, /no\s*cargo/i),
    status_revisar_imagen: s(/revisar\s*imagen/i),
  };
  for (const [k, v] of Object.entries(map)) if (typeof v === 'number') cf[k] = v;
  return cf;
}

// POST /api/admin/deploy
// Body: CreateTenantInput + { mode: 'provision' | 'discover', pipelineName? }
//  - provision: crea el embudo estándar + campos en el Kommo del cliente.
//  - discover : usa el embudo existente (mapea por nombre).
// Luego crea/actualiza el tenant y devuelve la URL del webhook.
export async function POST(req: NextRequest) {
  if (!(await isAdmin(req))) {
    return NextResponse.json({ error: 'no autorizado' }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as CreateTenantInput & {
    mode?: 'provision' | 'discover';
    pipelineName?: string;
  };
  if (!body.slug || !body.name || !body.kommoSubdomain || !body.kommoToken) {
    return NextResponse.json(
      { error: 'slug, name, kommoSubdomain y kommoToken son requeridos' },
      { status: 400 },
    );
  }

  let pipelineId: number;
  let customFields: Record<string, number>;
  const detail: Record<string, unknown> = {};

  try {
    if (body.mode === 'provision') {
      const r = await provisionClient(body.kommoSubdomain, body.kommoToken, {
        pipelineName: body.pipelineName,
      });
      pipelineId = r.pipelineId;
      customFields = buildCustomFields(r.fields, r.statuses);
      detail.provisioned = r.created;
    } else {
      const r = await discoverKommoConfig(body.kommoSubdomain, body.kommoToken, {
        pipelineName: body.pipelineName,
        pipelineId: body.kommoPipelineId,
      });
      pipelineId = r.pipelineId;
      customFields = { ...r.customFields };
      if (r.statusCargo) customFields.status_cargo = r.statusCargo;
      if (r.statusRevisarImagen) customFields.status_revisar_imagen = r.statusRevisarImagen;
      detail.warnings = r.warnings;
    }
  } catch (e) {
    return NextResponse.json({ error: String((e as Error).message ?? e) }, { status: 502 });
  }

  const row = await upsertTenant({
    ...body,
    role: 'client',
    kommoPipelineId: pipelineId,
    customFields: { ...customFields, ...(body.customFields ?? {}) },
  });

  return NextResponse.json({
    ok: true,
    tenant: { id: row.id, slug: row.slug },
    pipelineId,
    customFields: { ...customFields, ...(body.customFields ?? {}) },
    webhook: `/api/webhooks/kommo/${row.slug}`,
    ...detail,
  });
}

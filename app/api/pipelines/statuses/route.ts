import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getTenantBySlug } from '@/lib/tenants';
import { fetchPipelineStatuses } from '@/lib/kommo';

// GET /api/pipelines/statuses?pipeline_id= — estados de un pipeline (§6.6).
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no autenticado' }, { status: 401 });

  const tenant = await getTenantBySlug(session.slug);
  if (!tenant) return NextResponse.json({ error: 'tenant no encontrado' }, { status: 404 });

  const pipelineId =
    Number(req.nextUrl.searchParams.get('pipeline_id')) || tenant.kommoPipelineId;
  if (!pipelineId) return NextResponse.json({ error: 'pipeline_id requerido' }, { status: 400 });

  try {
    const list = await fetchPipelineStatuses(tenant, pipelineId);
    return NextResponse.json({
      pipeline_id: pipelineId,
      statuses: list.map((s) => ({ id: s.id, name: s.name, color: s.color, pipeline_id: s.pipeline_id })),
      total_statuses: list.length,
    });
  } catch (e) {
    return NextResponse.json({ error: String((e as Error).message) }, { status: 502 });
  }
}

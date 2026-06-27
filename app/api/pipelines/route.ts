import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getTenantBySlug } from '@/lib/tenants';
import { fetchPipelines } from '@/lib/kommo';

// GET /api/pipelines — proxy de solo lectura a Kommo (§6.6).
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no autenticado' }, { status: 401 });

  const tenant = await getTenantBySlug(session.slug);
  if (!tenant) return NextResponse.json({ error: 'tenant no encontrado' }, { status: 404 });

  try {
    const pipelines = await fetchPipelines(tenant);
    return NextResponse.json({
      pipelines: pipelines.map((p) => ({
        id: p.id,
        name: p.name,
        is_main: p.is_main ?? false,
        is_archive: p.is_archive ?? false,
      })),
    });
  } catch (e) {
    return NextResponse.json({ error: String((e as Error).message) }, { status: 502 });
  }
}

import { NextResponse } from 'next/server';
import { asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { statuses } from '@/db/schema';
import { getSession } from '@/lib/session';
import { getTenantBySlug } from '@/lib/tenants';
import { fetchPipelineStatuses } from '@/lib/kommo';

// GET /api/status — estados del sistema (espejo del pipeline Kommo, §6.3).
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no autenticado' }, { status: 401 });

  const rows = await db
    .select()
    .from(statuses)
    .where(eq(statuses.tenantId, session.tenantId))
    .orderBy(asc(statuses.kommoStatusId));

  return NextResponse.json({ statuses: rows });
}

// POST /api/status — sincroniza los estados desde Kommo (reemplaza el espejo).
export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no autenticado' }, { status: 401 });

  const tenant = await getTenantBySlug(session.slug);
  if (!tenant) return NextResponse.json({ error: 'tenant no encontrado' }, { status: 404 });
  if (!tenant.kommoPipelineId) {
    return NextResponse.json({ error: 'el tenant no tiene kommoPipelineId' }, { status: 400 });
  }

  let kommoStatuses;
  try {
    kommoStatuses = await fetchPipelineStatuses(tenant, tenant.kommoPipelineId);
  } catch (e) {
    return NextResponse.json({ error: String((e as Error).message) }, { status: 502 });
  }

  await db.delete(statuses).where(eq(statuses.tenantId, session.tenantId));
  if (kommoStatuses.length) {
    await db.insert(statuses).values(
      kommoStatuses.map((s) => ({
        tenantId: session.tenantId,
        kommoStatusId: s.id,
        name: s.name,
        color: s.color ?? null,
        pipelineId: s.pipeline_id,
      })),
    );
  }

  return NextResponse.json({ ok: true, synced: kommoStatuses.length });
}

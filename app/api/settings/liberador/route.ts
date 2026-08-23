import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { tenants } from '@/db/schema';
import { getSession } from '@/lib/session';
import { updateTenantFields } from '@/lib/tenants';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no autenticado' }, { status: 401 });

  const t = await db.query.tenants.findFirst({ where: eq(tenants.id, session.tenantId) });
  if (!t) return NextResponse.json({ error: 'no encontrado' }, { status: 404 });

  const cf = (t.customFields ?? {}) as Record<string, number>;
  return NextResponse.json({
    provider: t.provider ?? 'pagoda',
    partnerApiUrl: t.partnerApiUrl ?? '',
    hasKey: !!t.partnerApiKey,
    kingSourceId: cf.king_source_id ?? null,
  });
}

export async function PUT(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no autenticado' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    partnerApiUrl?: string;
    partnerApiKey?: string;
    enabled?: boolean;
    providerType?: 'partner_api' | 'king';
    kingSourceId?: number;
  };

  const t = await db.query.tenants.findFirst({ where: eq(tenants.id, session.tenantId) });
  if (!t) return NextResponse.json({ error: 'no encontrado' }, { status: 404 });

  const url = (body.partnerApiUrl ?? '').trim();
  const key = (body.partnerApiKey ?? '').trim();

  if (url) {
    try {
      const u = new URL(url);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('proto');
    } catch {
      return NextResponse.json({ error: 'URL inválida' }, { status: 400 });
    }
  }

  const willHaveKey = key.length > 0 || !!t.partnerApiKey;
  const willHaveUrl = url.length > 0 || !!t.partnerApiUrl;
  if (body.enabled && (!willHaveUrl || !willHaveKey)) {
    return NextResponse.json({ error: 'para activar hace falta URL y token' }, { status: 400 });
  }

  const providerType = body.providerType ?? 'partner_api';

  // King requires source_id
  if (body.enabled && providerType === 'king' && !body.kingSourceId) {
    const cf = (t.customFields ?? {}) as Record<string, number>;
    if (!cf.king_source_id) {
      return NextResponse.json({ error: 'para activar King hace falta el Source ID del agente' }, { status: 400 });
    }
  }

  const updates: Record<string, unknown> = {};
  if (url) updates.partnerApiUrl = url;
  if (key) updates.partnerApiKey = key;
  if (body.enabled !== undefined) {
    updates.provider = body.enabled ? providerType : 'pagoda';
  }

  // Store king_source_id in customFields
  if (body.kingSourceId != null) {
    const cf = { ...((t.customFields ?? {}) as Record<string, number>), king_source_id: body.kingSourceId };
    updates.customFields = cf;
  }

  await updateTenantFields(session.slug, updates);

  return NextResponse.json({ ok: true });
}

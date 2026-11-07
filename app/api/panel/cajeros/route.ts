import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { clientSettings } from '@/db/schema';
import { getSession } from '@/lib/session';
import { getCajeros, getCajerosTz, DEFAULT_CAJEROS_TZ, type CajeroConf } from '@/lib/chat/cajeros';

export const dynamic = 'force-dynamic';

async function loadChatConfig(tenantId: string): Promise<Record<string, unknown>> {
  const [row] = await db.select({ chatConfig: clientSettings.chatConfig }).from(clientSettings).where(eq(clientSettings.tenantId, tenantId)).limit(1);
  return (row?.chatConfig ?? {}) as Record<string, unknown>;
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no autenticado' }, { status: 401 });
  const cc = await loadChatConfig(session.tenantId);
  return NextResponse.json({ ok: true, cajeros: getCajeros(cc), cajerosTz: getCajerosTz(cc) });
}

const asStr = (v: unknown) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v));

function sanitize(raw: unknown): CajeroConf[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
    .slice(0, 20)
    .map((c, i) => ({
      id: asStr(c.id) || `c${i + 1}`,
      label: asStr(c.label) || `Cajero ${i + 1}`,
      cbu: asStr(c.cbu),
      titular: asStr(c.titular),
      wa: asStr(c.wa),
      schedule: Array.isArray(c.schedule)
        ? c.schedule
            .filter((w): w is Record<string, unknown> => !!w && typeof w === 'object')
            .map((w) => ({ from: asStr(w.from), to: asStr(w.to) }))
            .filter((w) => /^\d{1,2}:\d{2}$/.test(w.from) && /^\d{1,2}:\d{2}$/.test(w.to))
            .slice(0, 12)
        : [],
      fallback: c.fallback === true,
    }));
}

export async function PUT(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no autenticado' }, { status: 401 });
  // Solo admin/supervisor pueden tocar la config de cajeros.
  if (session.panelRole && session.panelRole !== 'admin' && session.panelRole !== 'supervisor') {
    return NextResponse.json({ error: 'sin permiso' }, { status: 403 });
  }
  const body = (await req.json().catch(() => ({}))) as { cajeros?: unknown; cajerosTz?: unknown };
  const cajeros = sanitize(body.cajeros);
  // Garantizamos un único fallback (si ninguno viene marcado, el primero).
  if (cajeros.length) {
    const hasFb = cajeros.some((c) => c.fallback);
    cajeros.forEach((c, i) => { c.fallback = hasFb ? c.fallback === true : i === 0; });
    let seen = false;
    for (const c of cajeros) { if (c.fallback && !seen) { seen = true; } else { c.fallback = false; } }
  }
  const tz = typeof body.cajerosTz === 'string' && body.cajerosTz.trim() ? body.cajerosTz.trim() : DEFAULT_CAJEROS_TZ;

  const prev = await loadChatConfig(session.tenantId);
  const next = { ...prev, cajeros, cajerosTz: tz };
  await db
    .insert(clientSettings)
    .values({ tenantId: session.tenantId, chatConfig: next })
    .onConflictDoUpdate({ target: clientSettings.tenantId, set: { chatConfig: next, updatedAt: new Date() } });

  return NextResponse.json({ ok: true, cajeros, cajerosTz: tz });
}

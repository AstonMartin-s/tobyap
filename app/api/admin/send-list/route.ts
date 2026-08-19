import { NextRequest, NextResponse } from 'next/server';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { tenants, sendList } from '@/db/schema';
import { isAdmin } from '@/lib/admin-auth';
import { phoneKey, phoneE164 } from '@/lib/phone';

// GET /api/admin/send-list?tenant=<slug> — resumen de la lista de envío cargada.
export async function GET(req: NextRequest) {
  if (!(await isAdmin(req))) return NextResponse.json({ error: 'no autorizado' }, { status: 401 });
  const slug = req.nextUrl.searchParams.get('tenant');
  if (!slug) return NextResponse.json({ error: 'tenant requerido' }, { status: 400 });
  const t = await db.query.tenants.findFirst({ where: eq(tenants.slug, slug) });
  if (!t) return NextResponse.json({ error: 'tenant no encontrado' }, { status: 404 });

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(sendList)
    .where(eq(sendList.tenantId, t.id));
  const byTier = await db
    .select({ ccpp: sendList.ccpp, count: sql<number>`count(*)::int` })
    .from(sendList)
    .where(eq(sendList.tenantId, t.id))
    .groupBy(sendList.ccpp);
  const sample = await db
    .select({ phone: sendList.phone, ccpp: sendList.ccpp, campaign: sendList.campaign })
    .from(sendList)
    .where(eq(sendList.tenantId, t.id))
    .orderBy(sql`updated_at desc`)
    .limit(10);

  return NextResponse.json({ total: count, byTier, sample });
}

// POST /api/admin/send-list — carga/actualiza la lista de envío (upsert, latest-wins).
// Body: { tenant, campaign?, ccpp?, text }  ó  { tenant, rows: [{phone, ccpp, campaign?}] }
//   - `text`: pegado con líneas "phone,ccpp" (o "phone" si se pasa `ccpp` global).
//     Separadores admitidos: coma, punto y coma, tab o espacios.
export async function POST(req: NextRequest) {
  if (!(await isAdmin(req))) return NextResponse.json({ error: 'no autorizado' }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as {
    tenant?: string;
    campaign?: string;
    ccpp?: string;
    portalSlug?: string; // global, si todo el segmento va a un portal
    text?: string;
    rows?: { phone?: string; ccpp?: string; campaign?: string; portalSlug?: string; enviadoAt?: string }[];
  };
  if (!b.tenant) return NextResponse.json({ error: 'tenant requerido' }, { status: 400 });
  const t = await db.query.tenants.findFirst({ where: eq(tenants.slug, b.tenant) });
  if (!t) return NextResponse.json({ error: 'tenant no encontrado' }, { status: 404 });

  const toDate = (s?: string | null): Date | null => {
    if (!s) return null;
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  };

  type Item = { phone: string; ccpp: string; campaign: string | null; portalSlug: string | null; sentAt: Date | null };
  // Normaliza a filas {phone, ccpp, campaign, portalSlug, sentAt}.
  const parsed: Item[] = [];
  if (Array.isArray(b.rows)) {
    for (const r of b.rows) {
      const ccpp = (r.ccpp ?? b.ccpp ?? '').trim();
      if (!r.phone || !ccpp) continue;
      parsed.push({
        phone: r.phone, ccpp,
        campaign: r.campaign ?? b.campaign ?? null,
        portalSlug: r.portalSlug ?? b.portalSlug ?? null,
        sentAt: toDate(r.enviadoAt),
      });
    }
  } else if (typeof b.text === 'string') {
    // Columnas: telefono,ccpp,campaign,enviado_at,portal_slug (3-5 opcionales).
    // Separadores: coma, punto y coma, tab. Cabecera opcional (se detecta y saltea).
    for (const line of b.text.split(/\r?\n/)) {
      const s = line.trim();
      if (!s) continue;
      const parts = s.split(/[,;\t]/).map((x) => x.trim());
      if (/tel[eé]fono|phone/i.test(parts[0])) continue; // cabecera
      const phone = parts[0];
      const ccpp = (parts[1] ?? b.ccpp ?? '').trim();
      if (!phone || !ccpp) continue;
      parsed.push({
        phone, ccpp,
        campaign: (parts[2] || b.campaign) ?? null,
        sentAt: toDate(parts[3]),
        portalSlug: (parts[4] || b.portalSlug) ?? null,
      });
    }
  }
  if (!parsed.length) {
    return NextResponse.json({ error: 'sin filas válidas (esperado "telefono,ccpp[,campaign,enviado_at,portal_slug]")' }, { status: 400 });
  }

  // Dedup por phoneKey dentro del lote (última gana).
  const byKey = new Map<string, Item>();
  let skipped = 0;
  for (const r of parsed) {
    const key = phoneKey(r.phone);
    if (!key) { skipped++; continue; }
    byKey.set(key, r);
  }

  let upserted = 0;
  for (const [key, r] of byKey) {
    const values = {
      tenantId: t.id,
      phone: phoneE164(r.phone),
      phoneKey: key,
      ccpp: r.ccpp.toUpperCase(),
      campaign: r.campaign,
      portalSlug: r.portalSlug,
      sentAt: r.sentAt,
    };
    await db
      .insert(sendList)
      .values(values)
      .onConflictDoUpdate({
        target: [sendList.tenantId, sendList.phoneKey],
        set: { ccpp: values.ccpp, campaign: r.campaign, portalSlug: r.portalSlug, sentAt: r.sentAt, updatedAt: new Date() },
      });
    upserted++;
  }

  return NextResponse.json({ ok: true, upserted, skipped });
}

// DELETE /api/admin/send-list?tenant=<slug>[&campaign=<c>] — limpia la lista.
export async function DELETE(req: NextRequest) {
  if (!(await isAdmin(req))) return NextResponse.json({ error: 'no autorizado' }, { status: 401 });
  const slug = req.nextUrl.searchParams.get('tenant');
  const campaign = req.nextUrl.searchParams.get('campaign');
  if (!slug) return NextResponse.json({ error: 'tenant requerido' }, { status: 400 });
  const t = await db.query.tenants.findFirst({ where: eq(tenants.slug, slug) });
  if (!t) return NextResponse.json({ error: 'tenant no encontrado' }, { status: 404 });

  const where = campaign
    ? and(eq(sendList.tenantId, t.id), eq(sendList.campaign, campaign))
    : eq(sendList.tenantId, t.id);
  await db.delete(sendList).where(where);
  return NextResponse.json({ ok: true });
}

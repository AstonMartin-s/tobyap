import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { clientSettings } from '@/db/schema';
import { getSession } from '@/lib/session';
import { parseChatConfig } from '@/lib/chat/brand';
import {
  buildConversationPreview,
  LINK_SLOTS,
  LINK_SLOT_IDS,
  parseChatRuntime,
  walinkSupportUrl,
  type LinkSlotId,
  type OfferType,
} from '@/lib/chat/runtime';
import { saveBrandAvatar } from '@/lib/storage';

export const dynamic = 'force-dynamic';

async function loadRow(tenantId: string) {
  const [row] = await db.select().from(clientSettings).where(eq(clientSettings.tenantId, tenantId)).limit(1);
  return row ?? null;
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no autenticado' }, { status: 401 });
  try {
    const row = await loadRow(session.tenantId);
    const brand = parseChatConfig(row?.chatConfig, session.slug, session.slug);
    const runtime = parseChatRuntime(row?.chatConfig, brand.brandName);
    const ld = (row?.chatConfig as Record<string, unknown> | null)?.landingDomain;
    runtime.links.support = walinkSupportUrl(session.slug, typeof ld === 'string' ? ld : undefined);
    const landingDomain = (row?.chatConfig as Record<string, unknown> | null)?.landingDomain;
    return NextResponse.json({
      ok: true,
      brand,
      runtime,
      landingDomain: typeof landingDomain === 'string' ? landingDomain : '',
      linkSlots: LINK_SLOTS,
      preview: buildConversationPreview(runtime),
    });
  } catch {
    const brand = parseChatConfig({}, session.slug, session.slug);
    const runtime = parseChatRuntime({}, brand.brandName);
    return NextResponse.json({
      ok: false,
      error: 'Falta columna chat_config (migración pendiente, no deploy)',
      brand,
      runtime,
      linkSlots: LINK_SLOTS,
      preview: buildConversationPreview(runtime),
    }, { status: 503 });
  }
}

export async function PUT(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no autenticado' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    brandName?: string;
    primaryColor?: string;
    avatarUrl?: string | null;
    offerType?: OfferType;
    offerValue?: number;
    minDeposit?: number;
    portalUrl?: string;
    supportUrl?: string;
    links?: Partial<Record<LinkSlotId, string>>;
    magicLinks?: LinkSlotId[];
    landingDomain?: string;
  };

  // Normaliza el dominio del landing del cliente a un origin https limpio (sin
  // path ni barra final). Vacío = usa el dominio público compartido.
  const normDomain = (raw: string): string => {
    const s = raw.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '').trim();
    return s ? `https://${s}` : '';
  };
  const row = await loadRow(session.tenantId);
  const prev = (row?.chatConfig ?? {}) as Record<string, unknown>;
  const prevRuntime = parseChatRuntime(prev, typeof prev.brandName === 'string' ? prev.brandName : session.slug);
  const mergedLinks = { ...prevRuntime.links };
  if (body.links && typeof body.links === 'object') {
    for (const id of LINK_SLOT_IDS) {
      const v = body.links[id];
      if (typeof v === 'string') mergedLinks[id] = v.trim();
    }
  }
  const isLinkSlot = (x: unknown): x is LinkSlotId => typeof x === 'string' && LINK_SLOT_IDS.includes(x as LinkSlotId);
  const next = {
    ...prev,
    brandName: typeof body.brandName === 'string' ? body.brandName.trim() : prev.brandName,
    primaryColor: typeof body.primaryColor === 'string' ? body.primaryColor.trim() : prev.primaryColor,
    avatarUrl: body.avatarUrl === null ? null : typeof body.avatarUrl === 'string' ? body.avatarUrl.trim() : prev.avatarUrl,
    offerType: body.offerType === 'fichas' || body.offerType === 'bonus' ? body.offerType : prev.offerType,
    offerValue: typeof body.offerValue === 'number' ? body.offerValue : prev.offerValue,
    minDeposit: typeof body.minDeposit === 'number' ? body.minDeposit : prev.minDeposit,
    links: mergedLinks,
    magicLinks: Array.isArray(body.magicLinks) ? body.magicLinks.filter(isLinkSlot) : prevRuntime.magicLinks,
    portalUrl: mergedLinks.portal_login,
    supportUrl: mergedLinks.support,
    landingDomain: typeof body.landingDomain === 'string' ? normDomain(body.landingDomain) : prev.landingDomain,
  };
  const [saved] = await db
    .insert(clientSettings)
    .values({ tenantId: session.tenantId, chatConfig: next })
    .onConflictDoUpdate({ target: clientSettings.tenantId, set: { chatConfig: next, updatedAt: new Date() } })
    .returning();
  const brand = parseChatConfig(saved.chatConfig, session.slug, session.slug);
  const runtime = parseChatRuntime(saved.chatConfig, brand.brandName);
  const savedDomain = (saved.chatConfig as Record<string, unknown> | null)?.landingDomain;
  return NextResponse.json({
    ok: true,
    brand,
    runtime,
    landingDomain: typeof savedDomain === 'string' ? savedDomain : '',
    preview: buildConversationPreview(runtime),
  });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no autenticado' }, { status: 401 });
  const form = await req.formData().catch(() => null);
  const file = form?.get('avatar');
  if (!(file instanceof File)) return NextResponse.json({ error: 'avatar requerido' }, { status: 400 });
  if (file.size > 2 * 1024 * 1024) return NextResponse.json({ error: 'imagen muy pesada (máx 2MB)' }, { status: 413 });
  const buf = Buffer.from(await file.arrayBuffer());
  const mime = file.type || 'image/jpeg';
  const rel = await saveBrandAvatar(session.tenantId, buf, mime);
  if (!rel) return NextResponse.json({ error: 'UPLOAD_DIR no configurado; pegá una URL de imagen' }, { status: 400 });

  const row = await loadRow(session.tenantId);
  const prev = (row?.chatConfig ?? {}) as Record<string, unknown>;
  const next = { ...prev, avatarPath: rel, avatarUrl: `/api/chat/${session.slug}/avatar` };
  await db
    .insert(clientSettings)
    .values({ tenantId: session.tenantId, chatConfig: next })
    .onConflictDoUpdate({ target: clientSettings.tenantId, set: { chatConfig: next, updatedAt: new Date() } });
  const brand = parseChatConfig(next, session.slug, session.slug);
  const runtime = parseChatRuntime(next, brand.brandName);
  return NextResponse.json({ ok: true, brand, runtime, preview: buildConversationPreview(runtime) });
}

import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getTenantBySlug, invalidateTenant, updateTenantFields } from '@/lib/tenants';
import {
  blasterAuth,
  blasterConfig,
  blasterLineIds,
  blasterLogout,
  blasterState,
  forgetLinePhone,
  lineIsLinked,
  lineIsResidue,
  packLineIds,
  phoneFromJid,
  rememberLinePhone,
  rememberedPhone,
  waMeLink,
  MAX_BLASTER_LINES,
} from '@/lib/blaster';

export const dynamic = 'force-dynamic';

type Cached = { at: number; payload: Record<string, unknown> };
const CACHE = new Map<string, Cached>();
const TTL_MS = 8000;

function linePayload(sessionId: string, state: Awaited<ReturnType<typeof blasterState>>) {
  const jid = state?.jid ?? null;
  const phone = phoneFromJid(jid) ?? rememberedPhone(sessionId);
  rememberLinePhone(sessionId, phone);
  return {
    sessionId,
    status: state?.status ?? 'unknown',
    jid,
    phone,
    link: waMeLink(jid) ?? waMeLink(phone),
    linked: lineIsLinked(state?.status, phone),
    known: state !== null,
    lastError: state?.lastError ?? null,
    qr: state?.qr ?? null,
    device: state?.device ?? null,
    connectionStatus: state?.connectionStatus ?? null,
    authenticationStatus: state?.authenticationStatus ?? null,
    lastCausalEvent: state?.lastCausalEvent ?? null,
    sessionHealth: state?.sessionHealth ?? null,
  };
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no autenticado' }, { status: 401 });

  const fresh = req.nextUrl.searchParams.get('fresh') === '1';
  const draftId = (req.nextUrl.searchParams.get('draft') ?? '').trim();
  const cached = CACHE.get(session.tenantId);
  if (!fresh && !draftId && cached && Date.now() - cached.at < TTL_MS) {
    return NextResponse.json(cached.payload);
  }

  const tenant = await getTenantBySlug(session.slug);
  const auth = tenant ? blasterAuth(tenant) : null;
  if (!tenant || !auth) {
    const payload = { ok: true, enabled: false, max: MAX_BLASTER_LINES, lines: [], draft: null };
    CACHE.set(session.tenantId, { at: Date.now(), payload });
    return NextResponse.json(payload);
  }

  const ids = blasterLineIds(tenant);
  const raw = await Promise.all(ids.map(async (id) => {
    const cfg = blasterConfig(tenant, id);
    const state = cfg ? await blasterState(cfg) : null;
    return linePayload(id, state);
  }));

  const keep = raw.filter((l) => !lineIsResidue(l.status, l.phone, l.known));
  const residue = raw.filter((l) => lineIsResidue(l.status, l.phone, l.known));
  if (residue.length) {
    for (const l of residue) {
      forgetLinePhone(l.sessionId);
      await blasterLogout({ ...auth, sessionId: l.sessionId }).catch(() => ({ ok: false }));
    }
    await updateTenantFields(tenant.slug, packLineIds(keep.map((l) => l.sessionId)));
    invalidateTenant(tenant.slug);
  }
  const lines = keep.map((l) => {
    const { known, ...line } = l;
    void known;
    return line;
  });

  let draft = null;
  if (draftId && !lines.some((l) => l.sessionId === draftId)) {
    const state = await blasterState({ ...auth, sessionId: draftId });
    const full = linePayload(draftId, state);
    const { known, ...line } = full;
    void known;
    draft = line;
  }

  const first = lines[0];
  const payload = {
    ok: true,
    enabled: true,
    max: MAX_BLASTER_LINES,
    lines,
    draft,
    status: first?.status ?? 'unknown',
    jid: first?.jid ?? null,
    lastError: first?.lastError ?? null,
    qr: first?.qr ?? null,
  };
  if (!draftId) CACHE.set(session.tenantId, { at: Date.now(), payload });
  return NextResponse.json(payload);
}

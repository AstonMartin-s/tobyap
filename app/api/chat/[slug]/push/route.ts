import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { chatSessions } from '@/db/schema';
import { getTenantBySlug } from '@/lib/tenants';
import { mergeChatData } from '@/lib/chat/mutations';
import { pushEnabled, vapidPublicKey } from '@/lib/chat/push';
import { normalizePushStatus, pushDataFromStatus } from '@/lib/chat/earlyPush';

export const dynamic = 'force-dynamic';

// GET /api/chat/[slug]/push → clave pública VAPID (para suscribir en el cliente).
// Si el push no está configurado, ok:false → el widget cae al modo in-page.
export async function GET() {
  return NextResponse.json({ ok: pushEnabled(), publicKey: vapidPublicKey() });
}

// POST /api/chat/[slug]/push  { sessionKey, subscription } → guarda la suscripción
// push en la sesión (habilitación PROLONGADA: dura hasta que el cliente revoque el
// permiso; no hay que reactivar por sesión).
export async function POST(req: NextRequest, { params }: { params: { slug: string } }) {
  const tenant = await getTenantBySlug(params.slug);
  if (!tenant) return NextResponse.json({ error: 'tenant desconocido' }, { status: 404 });

  const body = (await req.json().catch(() => null)) as {
    sessionKey?: string;
    subscription?: { endpoint?: string };
    permission?: string;
  } | null;
  const sessionKey = body?.sessionKey;
  const subscription = body?.subscription;
  const status = normalizePushStatus(body?.permission);
  if (!sessionKey || (!subscription?.endpoint && !status)) {
    return NextResponse.json({ error: 'sessionKey y subscription o permission requeridos' }, { status: 400 });
  }

  const [s] = await db
    .select()
    .from(chatSessions)
    .where(and(eq(chatSessions.tenantId, tenant.id), eq(chatSessions.sessionKey, sessionKey)));
  if (!s) return NextResponse.json({ error: 'sesión desconocida' }, { status: 404 });

  if (subscription?.endpoint) {
    if (!pushEnabled()) return NextResponse.json({ ok: false, disabled: true });
    await mergeChatData(s.id, { pushSub: subscription, pushAt: Date.now(), ...pushDataFromStatus('granted') });
  } else if (status) {
    await mergeChatData(s.id, pushDataFromStatus(status));
  }
  return NextResponse.json({ ok: true });
}

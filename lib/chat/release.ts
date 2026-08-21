import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { chatSessions } from '@/db/schema';
import { accreditedMessages } from '@/lib/chat/flow';
import { prepareBotBatch } from '@/lib/chat/stagger';
import { loadChatRuntime } from '@/lib/chat/loadRuntime';
import type { ResolvedTenant } from '@/lib/types';

// KOMMO MANDA: los empleados ordenan el embudo en Kommo, así que un cambio de
// etapa allá debe reflejarse en el estado del chat del panel. Mapeamos SOLO las
// etapas de resultado (las que usan para organizar); las tempranas quedan sin
// mapear para no pisar el avance natural del flujo.
export function panelStepFromKommoStatus(tenant: ResolvedTenant, statusId?: number | null): string | null {
  if (!statusId) return null;
  const cf = tenant.customFields;
  if (statusId === tenant.statusCargoId || statusId === 142) return 'done';
  if (statusId === cf['status_no_cargo'] || statusId === 143) return 'no_cargo';
  if (statusId === tenant.statusRevisarImagenId) return 'validando';
  return null;
}

// INVERSO: cuando el operador cambia el estado en el panel, movemos el lead a la
// etapa correspondiente en Kommo (bidireccional). Devuelve el statusId o null.
export function kommoStatusFromPanelStep(tenant: ResolvedTenant, step: string): number | null {
  const cf = tenant.customFields;
  switch (step) {
    case 'done': return tenant.statusCargoId ?? null;
    case 'no_cargo': return cf['status_no_cargo'] ?? null;
    case 'validando': return tenant.statusRevisarImagenId ?? null;
    case 'comprobante':
    case 'cbu': return cf['status_pidio_cbu'] ?? null;
    case 'credenciales': return cf['status_usuario_creado'] ?? null;
    case 'welcome': return cf['status_pidio_usuario'] ?? null;
    default: return null;
  }
}

// Sincroniza el estado del chat del panel a partir de la etapa de Kommo (lo llama
// el webhook). No manda mensajes al cliente (el "acreditado" lo maneja
// releaseChatOnCargo aparte). Idempotente.
export async function syncChatStepFromKommo(tenant: ResolvedTenant, kommoLeadId: number, statusId?: number | null): Promise<void> {
  const step = panelStepFromKommoStatus(tenant, statusId);
  if (!step) return;
  try {
    const [s] = await db
      .select()
      .from(chatSessions)
      .where(and(eq(chatSessions.tenantId, tenant.id), eq(chatSessions.kommoLeadId, kommoLeadId)));
    if (!s || s.step === step) return;
    await db.update(chatSessions).set({ step, updatedAt: new Date() }).where(eq(chatSessions.id, s.id));
  } catch {
    /* best-effort */
  }
}

// ── ACREDITACIÓN idempotente (candado atómico) ─────────────────────────────
// Entrega el mensaje "¡Acreditado!" al cliente UNA SOLA VEZ, sin importar cuántas
// fuentes lo disparen (webhook Cargo$, poll del widget, panel approve) ni el
// timing. El candado es `data.accreditedAt`: el UPDATE solo agrega los mensajes
// si ese flag todavía no existe, y Postgres serializa el UPDATE sobre la fila, así
// que dos disparos concurrentes NO pueden ambos ganar. Devuelve true solo si ESTA
// llamada fue la que acreditó (agregó los mensajes).
export async function acreditarChat(
  tenant: ResolvedTenant,
  opts: { kommoLeadId?: number | null; sessionKey?: string | null; requireComprobanteStep?: boolean },
): Promise<boolean> {
  const cond = opts.sessionKey
    ? and(eq(chatSessions.tenantId, tenant.id), eq(chatSessions.sessionKey, opts.sessionKey))
    : opts.kommoLeadId != null
      ? and(eq(chatSessions.tenantId, tenant.id), eq(chatSessions.kommoLeadId, opts.kommoLeadId))
      : null;
  if (!cond) return false;

  try {
    const [s] = await db.select().from(chatSessions).where(cond);
    if (!s) return false;
    const data = (s.data ?? {}) as Record<string, unknown>;
    if (data.accreditedAt) return false; // ya acreditado (fast-path)
    // Acreditación automática (webhook/poll): solo si ya mandó comprobante. El
    // approve del panel es explícito → pasa requireComprobanteStep=false.
    if (opts.requireComprobanteStep && !['comprobante', 'app_onboarding', 'validando'].includes(s.step ?? '')) return false;

    const cfg = await loadChatRuntime(tenant.id, tenant.name, s.phone, tenant.slug);
    const acc = prepareBotBatch(accreditedMessages(data.loginUrl as string | undefined, cfg));
    const accJson = JSON.stringify(acc.map((m) => ({ from: 'bot', text: m.text, at: m.at, delayMs: m.delayMs })));
    const now = Date.now();

    // UPDATE atómico con CANDADO: agrega los mensajes y marca accreditedAt solo si
    // aún no estaba marcado. `messages || ...` concatena jsonb atómicamente.
    const res = (await db.execute(sql`
      UPDATE chat_sessions
      SET messages = coalesce(messages, '[]'::jsonb) || ${accJson}::jsonb,
          step = 'done',
          data = jsonb_set(coalesce(data, '{}'::jsonb), '{accreditedAt}', to_jsonb(${now}::bigint)),
          updated_at = now()
      WHERE id = ${s.id}
        AND coalesce(data->>'accreditedAt', '') = ''
      RETURNING id
    `)) as unknown as { length?: number };
    return (res?.length ?? 0) > 0;
  } catch {
    return false;
  }
}

// Libera la acreditación cuando el lead entra a Cargo$ (lo llama emitCargo desde
// el webhook). Delega en la función idempotente. Firma estable para emitCargo.
export async function releaseChatOnCargo(tenant: ResolvedTenant, kommoLeadId: number): Promise<boolean> {
  return acreditarChat(tenant, { kommoLeadId, requireComprobanteStep: true });
}

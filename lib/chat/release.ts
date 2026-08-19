import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { chatSessions } from '@/db/schema';
import { accreditedMessages } from '@/lib/chat/flow';
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

// Libera la acreditación de un chat web cuando el lead entra a Cargo$ (lo llama
// el webhook de Kommo). Idempotente: solo actúa si la sesión está en curso.
// IMPORTANTE: sólo entrega al cliente el mensaje de aprobación de la ficha en el
// chat. NO cambia el estado del lead en Kommo — el movimiento de embudo lo
// maneja el operador manualmente (pedido del cliente).
export async function releaseChatOnCargo(tenant: ResolvedTenant, kommoLeadId: number): Promise<boolean> {
  try {
    const [s] = await db
      .select()
      .from(chatSessions)
      .where(and(eq(chatSessions.tenantId, tenant.id), eq(chatSessions.kommoLeadId, kommoLeadId)));
    if (!s || s.step === 'done') return false;
    // Libera si ya subió el comprobante (en cualquiera de sus sub-estados).
    if (!['comprobante', 'app_onboarding', 'validando'].includes(s.step ?? '')) return false;

    const acc = accreditedMessages((s.data as Record<string, unknown> | null)?.loginUrl as string | undefined);
    const messages = [...(s.messages ?? []), ...acc.map((m) => ({ from: 'bot' as const, text: m.text, at: m.at }))];
    await db.update(chatSessions).set({ messages, step: 'done', updatedAt: new Date() }).where(eq(chatSessions.id, s.id));
    return true;
  } catch {
    return false;
  }
}

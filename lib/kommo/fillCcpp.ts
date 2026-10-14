import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/db';
import { sendList } from '@/db/schema';
import { contactId, fetchContactPhone, fetchKommoLead, readLeadField, updateLeadFields } from '@/lib/kommo';
import { phoneCandidates } from '@/lib/phone';
import type { ResolvedTenant } from '@/lib/types';

// Spam Numero 3. El CCPP se escribe antes de la plantilla (Base de datos) y, si
// el lead entra directo al envío, en ese momento. No inventa un código.
const PIPELINE_ID = 13790083;
const STATUS_ANTES = 106401855;
const STATUS_ENVIO = 106401859;
const FIELD_ID = 1231586;
const ALLOWED = new Set(['B1', 'M3', 'A8', 'E15', 'W50']);

export function isSpamCcppStatus(statusId?: number | null): boolean {
  return statusId === STATUS_ANTES || statusId === STATUS_ENVIO;
}

/** Teléfono del contacto → send_list. Devuelve el código escrito, o null si no correspondía. */
export async function fillSpamCcpp(tenant: ResolvedTenant, leadId: number): Promise<string | null> {
  if (tenant.slug !== 'mooneyatkinson') return null;
  const fieldId = tenant.customFields.ccpp || FIELD_ID;
  const lead = await fetchKommoLead(tenant, leadId);
  if (lead.pipeline_id !== PIPELINE_ID || !isSpamCcppStatus(lead.status_id)) return null;

  const cId = contactId(lead);
  const phone = cId ? await fetchContactPhone(tenant, cId) : null;
  const keys = phoneCandidates(phone);
  if (!keys.length) return null;

  const ts = sql`coalesce(${sendList.sentAt}, ${sendList.updatedAt})`;
  const [hit] = await db
    .select({ ccpp: sendList.ccpp })
    .from(sendList)
    .where(and(eq(sendList.tenantId, tenant.id), inArray(sendList.phoneKey, keys)))
    .orderBy(desc(ts))
    .limit(1);
  const code = (hit?.ccpp ?? '').trim().toUpperCase();
  if (!ALLOWED.has(code)) return null;
  if ((readLeadField(lead, fieldId) ?? '').trim().toUpperCase() === code) return code;
  const ok = await updateLeadFields(tenant, leadId, [{ fieldId, value: code }]);
  return ok ? code : null;
}

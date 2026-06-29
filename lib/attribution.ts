import crypto from 'crypto';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { attributions, type AttributionRow } from '@/db/schema';
import { addLeadTags, updateLeadFields } from '@/lib/kommo';
import type { ResolvedTenant } from '@/lib/types';

// Mapa global por defecto CCPP -> bono. El tenant puede override (tenant.bonoMap).
export const DEFAULT_BONO_MAP: Record<string, string> = {
  A1: 'Bono10%',
  A3: 'Bono30%',
  A5: 'Bono50%',
  F1: 'FichasGratis',
  A200: 'Duplica',
};

export function resolveBono(tenant: ResolvedTenant, ccpp: string | null | undefined): string | null {
  if (!ccpp) return null;
  const override = tenant.bonoMap ?? {};
  return override[ccpp] ?? DEFAULT_BONO_MAP[ccpp] ?? null;
}

// Token único que viaja en el mensaje de WhatsApp. Distintivo (prefijo PB) para
// poder extraerlo del texto del primer mensaje con un regex simple.
export function generateCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin caracteres ambiguos
  let s = '';
  const bytes = crypto.randomBytes(6);
  for (const b of bytes) s += alphabet[b % alphabet.length];
  return `PB${s}`;
}

export const CODE_REGEX = /PB[A-HJ-NP-Z2-9]{6}/;

// Aplica una atribución ya guardada (por token) a un lead de Kommo:
//   - etiquetas: campaña (CC1) + bono (Bono10%)
//   - escribe fbclid / utm en los custom fields del lead (si están mapeados)
//   - marca la atribución como matcheada
// Devuelve la atribución para que el caller arme el evento de conversión.
export async function applyAttributionByCode(
  tenant: ResolvedTenant,
  kommoLeadId: number,
  code: string,
): Promise<AttributionRow | null> {
  const attr = await db.query.attributions.findFirst({
    where: and(eq(attributions.tenantId, tenant.id), eq(attributions.code, code)),
  });
  if (!attr) return null;

  // En modo readonly NO escribimos nada en el lead del CRM: solo matcheamos y
  // devolvemos la atribución para enriquecer el evento a Meta (tracking).
  if (!tenant.readonly) {
    // Etiquetas
    const tags = [attr.campaignId, attr.bono].filter((x): x is string => !!x);
    if (tags.length) await addLeadTags(tenant, kommoLeadId, tags).catch(() => false);

    // Custom fields (fbclid / utm) si el tenant los tiene mapeados
    const fields: Array<{ fieldId: number; value: string }> = [];
    const cf = tenant.customFields;
    if (cf.fbclid && attr.fbclid) fields.push({ fieldId: cf.fbclid, value: attr.fbclid });
    if (cf.utm_campaign && attr.campaignId) fields.push({ fieldId: cf.utm_campaign, value: attr.campaignId });
    if (cf.utm_source && attr.utmSource) fields.push({ fieldId: cf.utm_source, value: attr.utmSource });
    if (cf.utm_content && attr.utmContent) fields.push({ fieldId: cf.utm_content, value: attr.utmContent });
    if (fields.length) await updateLeadFields(tenant, kommoLeadId, fields).catch(() => false);
  }

  // Marca matcheada (idempotente)
  if (!attr.matchedLeadId) {
    await db
      .update(attributions)
      .set({ matchedLeadId: kommoLeadId, matchedAt: new Date() })
      .where(eq(attributions.id, attr.id));
  }
  return attr;
}

import crypto from 'crypto';
import { and, desc, eq, gte, isNull } from 'drizzle-orm';
import { db } from '@/db';
import { attributions, type AttributionRow } from '@/db/schema';
import { addLeadTags, updateLeadFields } from '@/lib/kommo';
import type { ResolvedTenant } from '@/lib/types';

// Mapa global por defecto CCPP -> bono. El tenant puede override (tenant.bonoMap).
export const DEFAULT_BONO_MAP: Record<string, string> = {
  A1: 'Bono10%',
  A2: 'Bono20%',
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

// Extrae nuestro `code` del `lead_id` que devuelve el webhook de afiliados. Como
// mandamos el code limpio en ?start=, normalmente es identidad; igual somos
// tolerantes: si viene embebido lo extraemos por regex, y si no, tomamos el
// último segmento de una posible URL/path.
export function parseLeadId(raw: string): string {
  const m = raw.match(CODE_REGEX);
  return m ? m[0] : (raw.split('/').pop() ?? raw);
}

// Match por PROXIMIDAD TEMPORAL (opción 2): para clientes cuyo lead no transporta
// el token en el mensaje (livechat de Kommo en portal externo). Toma la última
// atribución NO matcheada del tenant creada dentro de la ventana y la reclama de
// forma atómica para ESTE lead. El claim condicional (matchedLeadId IS NULL en el
// UPDATE) evita que dos leads concurrentes se lleven la misma atribución.
// Devuelve el code reclamado, o null si no hay candidata / ya la tomó otro.
// Es un match probabilístico: fiable con bajo volumen, se degrada con concurrencia.
export async function claimProximityAttribution(
  tenant: ResolvedTenant,
  kommoLeadId: number,
  windowSec: number,
): Promise<AttributionRow | null> {
  if (!windowSec || windowSec <= 0) return null;
  const cutoff = new Date(Date.now() - windowSec * 1000);

  const [cand] = await db
    .select()
    .from(attributions)
    .where(
      and(
        eq(attributions.tenantId, tenant.id),
        isNull(attributions.matchedLeadId),
        gte(attributions.createdAt, cutoff),
      ),
    )
    .orderBy(desc(attributions.createdAt))
    .limit(1);
  if (!cand) return null;

  const claimed = await db
    .update(attributions)
    .set({ matchedLeadId: kommoLeadId, matchedAt: new Date() })
    .where(and(eq(attributions.id, cand.id), isNull(attributions.matchedLeadId)))
    .returning();
  return claimed[0] ?? null; // vacío => lo reclamó otro lead en paralelo
}

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

  // Etiquetas (categoría + bono): se escriben si el tenant NO es readonly, O si es
  // readonly pero tiene la excepción allowTags. Es la única escritura permitida
  // en ese modo (nada de CBU/titular ni custom fields).
  if (!tenant.readonly || tenant.allowTags) {
    const tags = [attr.campaignId, attr.bono].filter((x): x is string => !!x);
    // Colores (paleta Kommo): bono en ámbar, campaña en rosa, para que resalten.
    const colors: Record<string, string> = {};
    if (attr.bono) colors[attr.bono] = 'FFCE5A';
    if (attr.campaignId) colors[attr.campaignId] = 'FFC8C8';
    if (tags.length) await addLeadTags(tenant, kommoLeadId, tags, colors).catch(() => false);
  }

  // Custom fields (fbclid / utm): SOLO si no es readonly. allowTags NO los habilita.
  if (!tenant.readonly) {
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

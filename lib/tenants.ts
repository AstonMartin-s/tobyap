import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import {
  tenants,
  clientSettings,
  numbers,
  rules,
  type TenantRow,
} from '@/db/schema';
import { encrypt, encryptOptional, decryptOptional } from '@/lib/crypto';
import type { CreateTenantInput, ResolvedTenant } from '@/lib/types';

// ---------------------------------------------------------------------------
// Campos del documento de cliente (estructura PAYBOT §4) que viven en `tenants`.
// Se arman una sola vez y se reutilizan en create/upsert para no duplicar lógica.
// ---------------------------------------------------------------------------
function tenantValues(input: CreateTenantInput) {
  return {
    name: input.name,
    kommoSubdomain: input.kommoSubdomain ?? null,
    kommoToken: encryptOptional(input.kommoToken),
    kommoEmail: input.kommoEmail ?? null,
    kommoPassword: encryptOptional(input.kommoPassword),
    kommoPipelineId: input.kommoPipelineId ?? null,
    panelUser: input.panelUser ?? null,
    openaiApiKey: encryptOptional(input.openaiApiKey),
    metaPixelId: input.metaPixelId ?? null,
    metaCapiToken: encryptOptional(input.metaCapiToken),
    eventSuffix: input.eventSuffix ?? null,
    customFields: input.customFields ?? {},
    bonoMap: input.bonoMap ?? {},
    // Documento de cliente (§4)
    role: input.role ?? 'client',
    platform: input.platform ?? 'meta',
    apiUrl: input.apiUrl ?? null,
    kommoDb: input.kommoDb ?? null,
    projectId: input.projectId ?? null,
    pspActive: input.pspActive ?? false,
    pspKey: encryptOptional(input.pspKey),
    externalApiKey: encryptOptional(input.externalApiKey),
  };
}

// Reemplaza las sub-entidades del cliente (settings 1:1, numbers/rules N). Idempotente.
async function replaceChildren(tenantId: string, input: CreateTenantInput) {
  if (input.settings) {
    await db
      .insert(clientSettings)
      .values({ tenantId, ...input.settings })
      .onConflictDoUpdate({
        target: clientSettings.tenantId,
        set: { ...input.settings, updatedAt: new Date() },
      });
  }

  if (input.numbers) {
    await db.delete(numbers).where(eq(numbers.tenantId, tenantId));
    if (input.numbers.length) {
      await db.insert(numbers).values(
        input.numbers.map((n) => ({
          tenantId,
          name: n.name ?? null,
          phone: n.phone ?? null,
          status: n.status ?? true,
          type: n.type ?? null,
        })),
      );
    }
  }

  if (input.rules) {
    await db.delete(rules).where(eq(rules.tenantId, tenantId));
    if (input.rules.length) {
      await db.insert(rules).values(
        input.rules.map((r) => ({
          tenantId,
          rule: r.rule ?? null,
          text: r.text ?? null,
          crm: r.crm ?? 'kommo',
          pipeline: r.pipeline ?? 'sales',
          priority: r.priority ?? 1,
          status: r.status ?? 'active',
        })),
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Alta de cliente: cifra secretos, hashea password de panel, inserta tenant
// + settings/numbers/rules.
// ---------------------------------------------------------------------------
export async function createTenant(input: CreateTenantInput): Promise<TenantRow> {
  const panelPasswordHash = input.panelPassword
    ? await bcrypt.hash(input.panelPassword, 10)
    : null;

  const [row] = await db
    .insert(tenants)
    .values({ slug: input.slug, panelPasswordHash, ...tenantValues(input) })
    .returning();

  await replaceChildren(row.id, input);
  return row;
}

// Upsert por slug (útil para el seed: re-correr no rompe).
export async function upsertTenant(input: CreateTenantInput): Promise<TenantRow> {
  const existing = await db.query.tenants.findFirst({
    where: eq(tenants.slug, input.slug),
  });
  if (!existing) return createTenant(input);

  const panelPasswordHash = input.panelPassword
    ? await bcrypt.hash(input.panelPassword, 10)
    : existing.panelPasswordHash;

  const [row] = await db
    .update(tenants)
    .set({ panelPasswordHash, ...tenantValues(input), updatedAt: new Date() })
    .where(eq(tenants.slug, input.slug))
    .returning();

  await replaceChildren(row.id, input);
  invalidateTenant(input.slug);
  return row;
}

// ---------------------------------------------------------------------------
// Resolución de tenant: descifra secretos en memoria + deriva atajos.
// Cache corto para no golpear DB + descifrar en cada webhook, pero permitiendo
// rotar secretos sin reiniciar el proceso.
// ---------------------------------------------------------------------------
const cache = new Map<string, { tenant: ResolvedTenant; exp: number }>();
const TTL_MS = 60_000;

function resolve(row: TenantRow): ResolvedTenant {
  const cf = (row.customFields ?? {}) as Record<string, number>;
  const num = (k: string): number | null => (typeof cf[k] === 'number' ? cf[k] : null);

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    kommoSubdomain: row.kommoSubdomain,
    kommoToken: decryptOptional(row.kommoToken),
    kommoPipelineId: row.kommoPipelineId,
    metaPixelId: row.metaPixelId,
    metaCapiToken: decryptOptional(row.metaCapiToken),
    eventSuffix: row.eventSuffix ?? '',
    apiUrl: row.apiUrl,
    externalApiKey: decryptOptional(row.externalApiKey),
    customFields: cf,
    bonoMap: (row.bonoMap ?? {}) as Record<string, string>,
    statusCargoId: num('status_cargo'),
    statusRevisarImagenId: num('status_revisar_imagen'),
    fieldFbclid: num('fbclid'),
    fieldFbc: num('fbc'),
    fieldFbp: num('fbp'),
    fieldUtmCampaign: num('utm_campaign'),
    fieldUtmSource: num('utm_source'),
    fieldUtmContent: num('utm_content'),
  };
}

export async function getTenantBySlug(slug: string): Promise<ResolvedTenant | null> {
  const hit = cache.get(slug);
  if (hit && hit.exp > Date.now()) return hit.tenant;

  const row = await db.query.tenants.findFirst({ where: eq(tenants.slug, slug) });
  if (!row || !row.active) return null;

  const tenant = resolve(row);
  cache.set(slug, { tenant, exp: Date.now() + TTL_MS });
  return tenant;
}

export function invalidateTenant(slug: string) {
  cache.delete(slug);
}

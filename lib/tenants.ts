import bcrypt from 'bcryptjs';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import {
  tenants,
  clientSettings,
  numbers,
  rules,
  landings,
  panelUsers,
  type TenantRow,
} from '@/db/schema';
import { encrypt, encryptOptional, decryptOptional } from '@/lib/crypto';
import { parseNiche } from '@/lib/niche';
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
    readonly: input.readonly ?? false,
    allowTags: input.allowTags ?? false,
    // Documento de cliente (§4)
    role: input.role ?? 'client',
    platform: input.platform ?? 'meta',
    niche: parseNiche(input.niche),
    apiUrl: input.apiUrl ?? null,
    kommoDb: input.kommoDb ?? null,
    projectId: input.projectId ?? null,
    pspActive: input.pspActive ?? false,
    pspKey: encryptOptional(input.pspKey),
    externalApiKey: encryptOptional(input.externalApiKey),
    pagodaUrl: input.pagodaUrl ?? null,
    pagodaApiKey: encryptOptional(input.pagodaApiKey),
    provider: input.provider ?? 'pagoda',
    partnerApiUrl: input.partnerApiUrl ?? null,
    partnerApiKey: encryptOptional(input.partnerApiKey),
  };
}

// Reemplaza las sub-entidades del cliente (settings 1:1, numbers/rules N,
// landings N, panel users N). Idempotente.
async function replaceChildren(tenantId: string, input: CreateTenantInput) {
  // settings (1:1) + chatConfig van a la misma fila client_settings.
  if (input.settings || input.chatConfig) {
    const settingsValues = {
      ...(input.settings ?? {}),
      ...(input.chatConfig ? { chatConfig: input.chatConfig } : {}),
    };
    await db
      .insert(clientSettings)
      .values({ tenantId, ...settingsValues })
      .onConflictDoUpdate({
        target: clientSettings.tenantId,
        set: { ...settingsValues, updatedAt: new Date() },
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

  // landings: upsert por (tenant, landingSlug) — no borramos las que no vengan
  // en el JSON para no pisar landings creadas aparte.
  if (input.landings) {
    for (const l of input.landings) {
      const values = {
        tenantId,
        landingSlug: l.landingSlug,
        alias: l.alias ?? null,
        name: l.name ?? null,
        type: l.type ?? 'publi',
        active: l.active ?? true,
        config: l.config ?? {},
      };
      const [existing] = await db
        .select()
        .from(landings)
        .where(and(eq(landings.tenantId, tenantId), eq(landings.landingSlug, l.landingSlug)));
      if (existing) {
        await db.update(landings).set(values).where(eq(landings.id, existing.id));
      } else {
        await db.insert(landings).values(values);
      }
    }
  }

  // panel users: upsert por (tenant, username). password en claro -> bcrypt.
  if (input.panelUsers) {
    for (const u of input.panelUsers) {
      const passwordHash = await bcrypt.hash(u.password, 10);
      const [existing] = await db
        .select()
        .from(panelUsers)
        .where(and(eq(panelUsers.tenantId, tenantId), eq(panelUsers.username, u.username)));
      if (existing) {
        await db
          .update(panelUsers)
          .set({
            passwordHash,
            displayName: u.displayName ?? existing.displayName,
            role: u.role ?? existing.role,
            active: u.active ?? existing.active,
            updatedAt: new Date(),
          })
          .where(eq(panelUsers.id, existing.id));
      } else {
        await db.insert(panelUsers).values({
          tenantId,
          username: u.username,
          passwordHash,
          displayName: u.displayName ?? null,
          role: u.role ?? 'operador',
          active: u.active ?? true,
        });
      }
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
// Edición parcial desde el admin: solo toca los campos provistos. Los secretos
// se re-cifran únicamente si vienen en el patch (no se pisan con vacío).
// ---------------------------------------------------------------------------
export interface UpdateTenantPatch {
  name?: string;
  eventSuffix?: string;
  readonly?: boolean;
  allowTags?: boolean;
  active?: boolean;
  panelPassword?: string; // reset
  metaPixelId?: string;
  metaCapiToken?: string;
  kommoToken?: string;
  customFields?: Record<string, number>;
  provider?: string;
  partnerApiUrl?: string;
  partnerApiKey?: string;
}

export async function updateTenantFields(slug: string, patch: UpdateTenantPatch): Promise<void> {
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.eventSuffix !== undefined) set.eventSuffix = patch.eventSuffix;
  if (patch.readonly !== undefined) set.readonly = patch.readonly;
  if (patch.allowTags !== undefined) set.allowTags = patch.allowTags;
  if (patch.active !== undefined) set.active = patch.active;
  if (patch.metaPixelId !== undefined) set.metaPixelId = patch.metaPixelId;
  if (patch.metaCapiToken) set.metaCapiToken = encrypt(patch.metaCapiToken);
  if (patch.kommoToken) set.kommoToken = encrypt(patch.kommoToken);
  if (patch.customFields !== undefined) set.customFields = patch.customFields;
  if (patch.provider !== undefined) set.provider = patch.provider;
  if (patch.partnerApiUrl !== undefined) set.partnerApiUrl = patch.partnerApiUrl;
  if (patch.partnerApiKey) set.partnerApiKey = encrypt(patch.partnerApiKey);
  if (patch.panelPassword) set.panelPasswordHash = await bcrypt.hash(patch.panelPassword, 10);

  await db.update(tenants).set(set).where(eq(tenants.slug, slug));
  invalidateTenant(slug);
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
    niche: parseNiche(row.niche),
    kommoSubdomain: row.kommoSubdomain,
    kommoToken: decryptOptional(row.kommoToken),
    kommoPipelineId: row.kommoPipelineId,
    metaPixelId: row.metaPixelId,
    metaCapiToken: decryptOptional(row.metaCapiToken),
    eventSuffix: row.eventSuffix ?? '',
    apiUrl: row.apiUrl,
    externalApiKey: decryptOptional(row.externalApiKey),
    pagodaUrl: row.pagodaUrl,
    pagodaApiKey: decryptOptional(row.pagodaApiKey),
    provider: row.provider ?? 'pagoda',
    partnerApiUrl: row.partnerApiUrl,
    partnerApiKey: decryptOptional(row.partnerApiKey),
    customFields: cf,
    bonoMap: (row.bonoMap ?? {}) as Record<string, string>,
    readonly: row.readonly ?? false,
    allowTags: row.allowTags ?? false,
    statusCargoId: num('status_cargo'),
    statusRevisarImagenId: num('status_revisar_imagen'),
    fieldFbclid: num('fbclid'),
    fieldFbc: num('fbc'),
    fieldFbp: num('fbp'),
    fieldUtmCampaign: num('utm_campaign'),
    fieldUtmSource: num('utm_source'),
    fieldUtmContent: num('utm_content'),
    proximityMatchSec: num('proximity_match_sec'),
    conversationValue: num('conversation_value_ars'),
    // Solapas opcionales: ausente = habilitado; solo 0 lo apaga.
    features: {
      reportes: cf['feat_reportes'] !== 0,
      embudo: cf['feat_embudo'] !== 0,
      livechat: cf['feat_livechat'] !== 0,
      fichas: cf['feat_fichas'] !== 0,
    },
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

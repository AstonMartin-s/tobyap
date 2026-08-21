import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { clientSettings } from '@/db/schema';
import { phoneCandidates } from '@/lib/phone';
import { parseChatRuntime, type ChatRuntimeConfig, type OfferType, walinkSupportUrl } from '@/lib/chat/runtime';

function clampNum(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** Si el teléfono está en chat_config.testPhones, aplica chat_config.testRuntime (modo prueba). */
export function applyPhoneTestRuntime(
  cfg: ChatRuntimeConfig,
  raw: unknown,
  phone?: string | null,
): ChatRuntimeConfig {
  if (!phone) return cfg;
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const testPhones = Array.isArray(o.testPhones)
    ? o.testPhones.map((p) => String(p)).filter(Boolean)
    : [];
  if (!testPhones.length) return cfg;
  const keys = new Set(phoneCandidates(phone));
  const hit = testPhones.some((p) => phoneCandidates(p).some((c) => keys.has(c)));
  if (!hit) return cfg;
  const tr = o.testRuntime && typeof o.testRuntime === 'object' && !Array.isArray(o.testRuntime)
    ? (o.testRuntime as Record<string, unknown>)
    : {};
  const offerType: OfferType = tr.offerType === 'fichas' ? 'fichas' : tr.offerType === 'bonus' ? 'bonus' : cfg.offerType;
  return {
    ...cfg,
    offerType,
    offerValue: tr.offerValue !== undefined ? clampNum(tr.offerValue, 1, 999999, cfg.offerValue) : cfg.offerValue,
    minDeposit: tr.minDeposit !== undefined ? clampNum(tr.minDeposit, 100, 50_000_000, cfg.minDeposit) : cfg.minDeposit,
  };
}

export async function loadChatRuntime(
  tenantId: string,
  fallbackBrand: string,
  phone?: string | null,
  tenantSlug?: string,
): Promise<ChatRuntimeConfig> {
  try {
    const [row] = await db
      .select({ chatConfig: clientSettings.chatConfig })
      .from(clientSettings)
      .where(eq(clientSettings.tenantId, tenantId))
      .limit(1);
    const raw = row?.chatConfig;
    const base = parseChatRuntime(raw, fallbackBrand);
    if (tenantSlug) {
      const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
      const ld = typeof o.landingDomain === 'string' ? o.landingDomain : '';
      base.links = { ...base.links, support: walinkSupportUrl(tenantSlug, ld || undefined) };
    }
    return applyPhoneTestRuntime(base, raw, phone);
  } catch {
    const base = parseChatRuntime({}, fallbackBrand);
    if (tenantSlug) base.links = { ...base.links, support: walinkSupportUrl(tenantSlug) };
    return base;
  }
}

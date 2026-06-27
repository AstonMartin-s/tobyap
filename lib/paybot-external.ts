import type { ResolvedTenant } from '@/lib/types';

// ---------------------------------------------------------------------------
// Cliente de la API externa del sistema PAYBOT original (por cliente):
//   GET <apiUrl>/api/external/conversions   (auth: x-api-key)
// Devuelve conteos de conversiones (evento 1) y cargas (evento 2) + redirects,
// y opcionalmente los records crudos (send_meta) para importar.
// ---------------------------------------------------------------------------

export interface ConversionsFilters {
  campaignId?: string;
  startDate?: string; // ISO 8601
  endDate?: string; // ISO 8601
  eventName?: string;
  eventSourceUrl?: string;
  includeRecords?: boolean;
}

export interface ConversionsTotals {
  conversiones: { eventName: string; count: number };
  cargas: { eventName: string; count: number };
  totalEvents: number;
  totalRedirects: number;
  eventTypes: string[];
  records?: PaybotRecord[];
}

export interface PaybotRecord {
  _id: string;
  conversionData?: Array<{ data?: Array<{ event_name?: string; event_time?: number; event_source_url?: string; user_data?: Record<string, unknown> }> }>;
  campaignId?: string;
  messageData?: unknown;
  extractedCode?: string;
  conversionResults?: unknown;
  timestamp?: string;
  success?: boolean;
  metaCampaignId?: string;
  metaCampaignName?: string;
  metaAdId?: string;
  metaAdName?: string;
}

function endpoint(tenant: ResolvedTenant): { url: string; key: string } {
  if (!tenant.apiUrl || !tenant.externalApiKey) {
    throw new Error(`Tenant ${tenant.slug} sin apiUrl / externalApiKey`);
  }
  return { url: `${tenant.apiUrl.replace(/\/$/, '')}/api/external/conversions`, key: tenant.externalApiKey };
}

export async function fetchConversions(
  tenant: ResolvedTenant,
  filters: ConversionsFilters = {},
): Promise<ConversionsTotals> {
  const { url, key } = endpoint(tenant);
  const params = new URLSearchParams();
  if (filters.campaignId) params.set('campaignId', filters.campaignId);
  if (filters.startDate) params.set('startDate', filters.startDate);
  if (filters.endDate) params.set('endDate', filters.endDate);
  if (filters.eventName) params.set('eventName', filters.eventName);
  if (filters.eventSourceUrl) params.set('eventSourceUrl', filters.eventSourceUrl);
  if (filters.includeRecords) params.set('includeRecords', 'true');

  const res = await fetch(`${url}?${params}`, { headers: { 'x-api-key': key } });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`API externa ${tenant.slug}: HTTP ${res.status} ${err.error ?? ''}`);
  }
  const json = (await res.json()) as { success: boolean; data: ConversionsTotals };
  return json.data;
}

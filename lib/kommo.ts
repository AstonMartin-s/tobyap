import type { ResolvedTenant } from '@/lib/types';

// ---------------------------------------------------------------------------
// Cliente Kommo: traer el lead completo (el webhook no manda todos los campos)
// y leer custom fields por id.
// ---------------------------------------------------------------------------

export interface KommoLead {
  id: number;
  name?: string;
  status_id?: number;
  pipeline_id?: number;
  custom_fields_values?: Array<{
    field_id: number;
    field_code?: string;
    values: Array<{ value: string }>;
  }>;
  _embedded?: {
    contacts?: Array<{
      id: number;
      custom_fields_values?: Array<{
        field_id?: number;
        field_code?: string;
        field_name?: string;
        values: Array<{ value: string }>;
      }>;
    }>;
  };
}

export async function fetchKommoLead(
  tenant: ResolvedTenant,
  leadId: number,
): Promise<KommoLead> {
  if (!tenant.kommoSubdomain || !tenant.kommoToken) {
    throw new Error(`Tenant ${tenant.slug} sin credenciales de Kommo`);
  }
  const url = `https://${tenant.kommoSubdomain}.kommo.com/api/v4/leads/${leadId}?with=contacts`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${tenant.kommoToken}` },
  });
  if (!res.ok) throw new Error(`Kommo lead ${leadId}: HTTP ${res.status}`);
  return (await res.json()) as KommoLead;
}

// Lee el valor de un custom field del lead por id.
export function readLeadField(lead: KommoLead, fieldId: number | null): string | null {
  if (!fieldId) return null;
  const cf = lead.custom_fields_values?.find((f) => f.field_id === fieldId);
  return cf?.values?.[0]?.value ?? null;
}

// El teléfono suele estar en el contacto embebido (field_code PHONE).
export function readPhone(lead: KommoLead): string | null {
  const contact = lead._embedded?.contacts?.[0];
  const phone = contact?.custom_fields_values?.find(
    (f) => f.field_code === 'PHONE' || f.field_name?.toLowerCase().includes('tel'),
  );
  return phone?.values?.[0]?.value ?? null;
}

export function contactId(lead: KommoLead): number | null {
  return lead._embedded?.contacts?.[0]?.id ?? null;
}

// El contacto embebido en el lead NO trae custom_fields_values; hay que pedir el
// contacto aparte para sacar el teléfono (field_code PHONE).
export async function fetchContactPhone(
  tenant: ResolvedTenant,
  cId: number,
): Promise<string | null> {
  if (!tenant.kommoSubdomain || !tenant.kommoToken) return null;
  const url = `https://${tenant.kommoSubdomain}.kommo.com/api/v4/contacts/${cId}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${tenant.kommoToken}` } });
  if (!res.ok) return null;
  const c = (await res.json()) as {
    custom_fields_values?: Array<{ field_code?: string; field_name?: string; values: Array<{ value: string }> }>;
  };
  const phone = c.custom_fields_values?.find(
    (f) => f.field_code === 'PHONE' || (f.field_name ?? '').toLowerCase().includes('tel'),
  );
  return phone?.values?.[0]?.value ?? null;
}

// ---------------------------------------------------------------------------
// Pipelines / estados (proxy de solo lectura hacia Kommo v4).
// ---------------------------------------------------------------------------

export interface KommoStatus {
  id: number;
  name: string;
  color?: string;
  sort?: number;
  pipeline_id: number;
}

export interface KommoPipeline {
  id: number;
  name: string;
  sort?: number;
  is_main?: boolean;
  is_archive?: boolean;
  _embedded?: { statuses?: KommoStatus[] };
}

function kommoBase(tenant: ResolvedTenant): { url: string; headers: HeadersInit } {
  if (!tenant.kommoSubdomain || !tenant.kommoToken) {
    throw new Error(`Tenant ${tenant.slug} sin credenciales de Kommo`);
  }
  return {
    url: `https://${tenant.kommoSubdomain}.kommo.com/api/v4`,
    headers: { Authorization: `Bearer ${tenant.kommoToken}` },
  };
}

export async function fetchPipelines(tenant: ResolvedTenant): Promise<KommoPipeline[]> {
  const { url, headers } = kommoBase(tenant);
  const res = await fetch(`${url}/leads/pipelines`, { headers });
  if (!res.ok) throw new Error(`Kommo pipelines: HTTP ${res.status}`);
  const data = (await res.json()) as { _embedded?: { pipelines?: KommoPipeline[] } };
  return data._embedded?.pipelines ?? [];
}

export async function fetchPipelineStatuses(
  tenant: ResolvedTenant,
  pipelineId: number,
): Promise<KommoStatus[]> {
  const { url, headers } = kommoBase(tenant);
  const res = await fetch(`${url}/leads/pipelines/${pipelineId}`, { headers });
  if (!res.ok) throw new Error(`Kommo pipeline ${pipelineId}: HTTP ${res.status}`);
  const data = (await res.json()) as KommoPipeline;
  return data._embedded?.statuses ?? [];
}

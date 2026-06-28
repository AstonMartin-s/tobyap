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

// Escribe custom fields en un lead (PATCH). Usado por el CBU variable.
export async function updateLeadFields(
  tenant: ResolvedTenant,
  leadId: number,
  fields: Array<{ fieldId: number; value: string }>,
): Promise<boolean> {
  if (!tenant.kommoSubdomain || !tenant.kommoToken || !fields.length) return false;
  const url = `https://${tenant.kommoSubdomain}.kommo.com/api/v4/leads/${leadId}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${tenant.kommoToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      custom_fields_values: fields.map((f) => ({ field_id: f.fieldId, values: [{ value: f.value }] })),
    }),
  });
  return res.ok;
}

// Agrega etiquetas a un lead SIN pisar las existentes (Kommo PATCH reemplaza la
// lista, así que primero leemos las actuales y mergeamos por nombre).
export async function addLeadTags(
  tenant: ResolvedTenant,
  leadId: number,
  names: string[],
): Promise<boolean> {
  if (!tenant.kommoSubdomain || !tenant.kommoToken || !names.length) return false;
  const base = `https://${tenant.kommoSubdomain}.kommo.com/api/v4/leads/${leadId}`;
  const headers = { Authorization: `Bearer ${tenant.kommoToken}`, 'Content-Type': 'application/json' };

  const cur = await fetch(`${base}?with=tags`, { headers });
  const existing: Array<{ name: string }> =
    cur.ok ? ((await cur.json())?._embedded?.tags ?? []) : [];
  const merged = new Map<string, { name: string }>();
  for (const t of existing) merged.set(t.name, { name: t.name });
  for (const n of names) if (n) merged.set(n, { name: n });

  const res = await fetch(base, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ _embedded: { tags: [...merged.values()] } }),
  });
  return res.ok;
}

// Extrae lead ids de un payload de send_hook de Kommo (form), JSON o query.
export function parseLeadIds(raw: string, params: URLSearchParams): number[] {
  const ids = new Set<number>();
  const q = params.get('lead_id') || params.get('id');
  if (q && /^\d+$/.test(q)) ids.add(Number(q));
  for (const m of raw.matchAll(/\[id\]=(\d+)/g)) ids.add(Number(m[1]));
  try {
    const j = JSON.parse(raw);
    if (j.lead_id) ids.add(Number(j.lead_id));
    if (Array.isArray(j.leads)) for (const l of j.leads) if (l?.id) ids.add(Number(l.id));
  } catch {
    /* no era JSON */
  }
  return [...ids];
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

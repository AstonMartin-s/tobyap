// ---------------------------------------------------------------------------
// Provisionador: crea en el Kommo del cliente la estructura base (embudo estándar
// + custom fields) vía API. Después, discoverKommoConfig mapea todo por nombre.
//
// Lo que NO crea por API (limitación de Kommo): los SALESBOTS (WELCOME, CARGO,
// CBU, REVISAR_IMAGEN...). Esos se importan a mano en el diseñador de Salesbot y
// se les configura el send_hook a nuestros endpoints (ver ONBOARDING.md).
// ---------------------------------------------------------------------------

// Embudo estándar (matriz publigreenbetmia). "Incoming leads" y ganados/perdidos
// los crea Kommo solo; nosotros agregamos los intermedios.
export const STANDARD_STATUSES: Array<{ name: string; sort: number; color: string }> = [
  { name: 'Revisar', sort: 20, color: '#ffff99' },
  { name: 'Pidio Usuario', sort: 30, color: '#99ccff' },
  { name: 'Pidio CbuAlias', sort: 40, color: '#f9deff' },
  { name: 'Revisar imagen', sort: 50, color: '#ffdc7f' },
  { name: 'Cargo$', sort: 60, color: '#87f2c0' },
  { name: 'No Atender', sort: 70, color: '#ffcccc' },
  { name: 'No Cargo', sort: 80, color: '#f2f3f4' },
  { name: 'Seguimiento', sort: 90, color: '#ffcc66' },
];

// Custom fields base (todos type "text" para poder leerlos y escribirlos).
export const STANDARD_FIELDS = ['fbclid', 'utm_campaign', 'utm_source', 'utm_content', 'CBU', 'TITULAR'];

interface ProvisionResult {
  pipelineId: number;
  pipelineName: string;
  statuses: { id: number; name: string }[];
  fields: Record<string, number>;
  created: { statuses: number; fields: string[] };
}

async function kommo<T>(subdomain: string, token: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`https://${subdomain}.kommo.com/api/v4${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`Kommo ${init?.method ?? 'GET'} ${path}: HTTP ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

const norm = (s: string) => s.trim().toLowerCase();

// Crea el pipeline estándar (o lo reutiliza si ya existe por nombre).
async function ensurePipeline(subdomain: string, token: string, name: string) {
  const existing = await kommo<{ _embedded?: { pipelines?: Array<{ id: number; name: string; _embedded?: { statuses?: Array<{ id: number; name: string }> } }> } }>(
    subdomain,
    token,
    '/leads/pipelines',
  );
  const found = existing._embedded?.pipelines?.find((p) => norm(p.name) === norm(name));
  if (found) {
    return { id: found.id, name: found.name, statuses: found._embedded?.statuses ?? [], createdStatuses: 0 };
  }
  const res = await kommo<{ _embedded: { pipelines: Array<{ id: number; name: string; _embedded?: { statuses?: Array<{ id: number; name: string }> } }> } }>(
    subdomain,
    token,
    '/leads/pipelines',
    {
      method: 'POST',
      body: JSON.stringify([
        { name, is_main: false, _embedded: { statuses: STANDARD_STATUSES } },
      ]),
    },
  );
  const p = res._embedded.pipelines[0];
  return { id: p.id, name: p.name, statuses: p._embedded?.statuses ?? [], createdStatuses: STANDARD_STATUSES.length };
}

// Crea los custom fields que falten (por nombre). Devuelve nombre->id de todos.
async function ensureFields(subdomain: string, token: string) {
  const cur = await kommo<{ _embedded?: { custom_fields?: Array<{ id: number; name: string }> } }>(
    subdomain,
    token,
    '/leads/custom_fields',
  );
  const byName = new Map<string, number>();
  for (const f of cur._embedded?.custom_fields ?? []) byName.set(norm(f.name), f.id);

  const missing = STANDARD_FIELDS.filter((f) => !byName.has(norm(f)));
  const created: string[] = [];
  if (missing.length) {
    const res = await kommo<{ _embedded: { custom_fields: Array<{ id: number; name: string }> } }>(
      subdomain,
      token,
      '/leads/custom_fields',
      { method: 'POST', body: JSON.stringify(missing.map((name) => ({ name, type: 'text' }))) },
    );
    for (const f of res._embedded.custom_fields) {
      byName.set(norm(f.name), f.id);
      created.push(f.name);
    }
  }

  const fields: Record<string, number> = {};
  for (const f of STANDARD_FIELDS) {
    const id = byName.get(norm(f));
    if (id) fields[f] = id;
  }
  return { fields, created };
}

export async function provisionClient(
  subdomain: string,
  token: string,
  opts: { pipelineName?: string } = {},
): Promise<ProvisionResult> {
  const name = opts.pipelineName ?? 'Embudo de ventas';
  const pipe = await ensurePipeline(subdomain, token, name);
  const f = await ensureFields(subdomain, token);
  return {
    pipelineId: pipe.id,
    pipelineName: pipe.name,
    statuses: pipe.statuses,
    fields: f.fields,
    created: { statuses: pipe.createdStatuses, fields: f.created },
  };
}

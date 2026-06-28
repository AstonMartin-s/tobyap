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
// Colores de la paleta válida de Kommo (no acepta hex arbitrarios).
export const STANDARD_STATUSES: Array<{ name: string; sort: number; color: string }> = [
  { name: 'Revisar', sort: 20, color: '#fffd7f' },
  { name: 'Pidio Usuario', sort: 30, color: '#98cbff' },
  { name: 'Pidio CbuAlias', sort: 40, color: '#f9deff' },
  { name: 'Revisar imagen', sort: 50, color: '#ffdc7f' },
  { name: 'Cargo$', sort: 60, color: '#87f2c0' },
  { name: 'No Atender', sort: 70, color: '#ffc8c8' },
  { name: 'No Cargo', sort: 80, color: '#f2f3f4' },
  { name: 'Seguimiento', sort: 90, color: '#ffce5a' },
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

interface StatusRaw { id: number; name: string; is_editable?: boolean; type?: number; sort?: number }

// Deja el pipeline elegido (por nombre o el principal) con los estados estándar:
// agrega los que faltan (por nombre) y borra los default no estándar (cuenta nueva).
async function ensurePipeline(subdomain: string, token: string, name: string) {
  const list = await kommo<{ _embedded?: { pipelines?: Array<{ id: number; name: string; is_main?: boolean; _embedded?: { statuses?: StatusRaw[] } }> } }>(
    subdomain,
    token,
    '/leads/pipelines',
  );
  const pipelines = list._embedded?.pipelines ?? [];
  const p =
    pipelines.find((x) => norm(x.name) === norm(name)) ??
    pipelines.find((x) => x.is_main) ??
    pipelines[0];
  if (!p) throw new Error('No hay pipeline para provisionar');

  let statuses = p._embedded?.statuses ?? [];
  const have = new Set(statuses.map((s) => norm(s.name)));

  // 1) Agregar los estándar que falten.
  const toAdd = STANDARD_STATUSES.filter((s) => !have.has(norm(s.name)));
  if (toAdd.length) {
    await kommo(subdomain, token, `/leads/pipelines/${p.id}/statuses`, {
      method: 'POST',
      body: JSON.stringify(toAdd),
    });
  }

  // 2) Borrar estados default no estándar (editables, no de sistema). Cuenta nueva
  //    => sin leads, es seguro. Conservamos "Incoming leads" y los nuestros.
  const keep = new Set<string>(STANDARD_STATUSES.map((s) => norm(s.name)));
  keep.add('incoming leads');
  for (const s of statuses) {
    if (s.is_editable && s.type !== 1 && s.id !== 142 && s.id !== 143 && !keep.has(norm(s.name))) {
      await kommo(subdomain, token, `/leads/pipelines/${p.id}/statuses/${s.id}`, { method: 'DELETE' }).catch(() => {});
    }
  }

  // 3) Re-leer estados finales.
  const fresh = await kommo<{ _embedded?: { statuses?: StatusRaw[] } }>(
    subdomain,
    token,
    `/leads/pipelines/${p.id}`,
  );
  statuses = fresh._embedded?.statuses ?? statuses;
  return { id: p.id, name: p.name, statuses, createdStatuses: toAdd.length };
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

// ---------------------------------------------------------------------------
// Descubrimiento de config de Kommo para ONBOARDING de clientes nuevos.
// Dado subdominio + token, encuentra el pipeline y mapea por NOMBRE los estados
// y custom fields a nuestros roles. Esto estandariza el alta: el cliente solo
// aporta credenciales, no IDs.
//
// Modelo estándar de embudo (ej. "Embudo de ventas"):
//   Incoming → Revisar → Pidio Usuario → Pidio CbuAlias → Revisar imagen →
//   Cargo$ (conversión) → No Atender → No Cargo → Seguimiento → ganados/perdidos
// ---------------------------------------------------------------------------

interface KommoStatusRaw { id: number; name: string; pipeline_id: number }
interface KommoPipelineRaw {
  id: number;
  name: string;
  is_main?: boolean;
  is_archive?: boolean;
  _embedded?: { statuses?: KommoStatusRaw[] };
}
interface KommoFieldRaw { id: number; name: string; code?: string }

export interface DiscoveredConfig {
  pipelineId: number;
  pipelineName: string;
  statuses: { id: number; name: string }[];
  statusCargo: number | null;
  statusRevisarImagen: number | null;
  customFields: Record<string, number>;
  warnings: string[];
}

async function kommoGet<T>(subdomain: string, token: string, path: string): Promise<T> {
  const res = await fetch(`https://${subdomain}.kommo.com/api/v4${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Kommo ${path}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

const norm = (s: string) => s.trim().toLowerCase();

export async function discoverKommoConfig(
  subdomain: string,
  token: string,
  opts: { pipelineName?: string; pipelineId?: number } = {},
): Promise<DiscoveredConfig> {
  const warnings: string[] = [];

  // 1) Pipeline: por id, por nombre, o el principal (is_main).
  const pdata = await kommoGet<{ _embedded?: { pipelines?: KommoPipelineRaw[] } }>(
    subdomain,
    token,
    '/leads/pipelines',
  );
  const pipelines = pdata._embedded?.pipelines ?? [];
  let pipeline: KommoPipelineRaw | undefined;
  if (opts.pipelineId) pipeline = pipelines.find((p) => p.id === opts.pipelineId);
  else if (opts.pipelineName)
    pipeline = pipelines.find((p) => norm(p.name).includes(norm(opts.pipelineName!)));
  else pipeline = pipelines.find((p) => p.is_main) ?? pipelines[0];

  if (!pipeline) throw new Error('No se encontró el pipeline');

  const statuses = (pipeline._embedded?.statuses ?? []).map((s) => ({ id: s.id, name: s.name }));

  // 2) Estados clave por nombre.
  //    cargo: contiene "cargo" pero NO "no cargo". Sirve para el modelo estándar
  //    ("Cargo$") y para variantes tipo "P4 - CARGO ✅". Si hay varios, prioriza
  //    el que empieza con "cargo", luego el que tiene ✅, luego el primero.
  const cargoCandidates = statuses.filter(
    (s) => /cargo/i.test(s.name) && !/no\s*cargo/i.test(s.name),
  );
  const statusCargo =
    (cargoCandidates.find((s) => /^cargo/i.test(s.name.trim())) ??
      cargoCandidates.find((s) => s.name.includes('✅')) ??
      cargoCandidates[0])?.id ?? null;
  const statusRevisarImagen = statuses.find((s) => /revisar\s*imagen/i.test(s.name))?.id ?? null;
  if (!statusCargo) warnings.push('No se encontró estado de carga (esperado nombre tipo "Cargo$")');
  if (!statusRevisarImagen) warnings.push('No se encontró estado "Revisar imagen"');

  // 3) Custom fields por nombre (atribución).
  const fdata = await kommoGet<{ _embedded?: { custom_fields?: KommoFieldRaw[] } }>(
    subdomain,
    token,
    '/leads/custom_fields',
  );
  const fields = fdata._embedded?.custom_fields ?? [];
  const byName = (name: string) => fields.find((f) => norm(f.name) === name)?.id;

  const customFields: Record<string, number> = {};
  for (const key of ['fbclid', 'utm_campaign', 'utm_source', 'utm_content']) {
    const id = byName(key);
    if (id) customFields[key] = id;
  }
  if (statusCargo) customFields.status_cargo = statusCargo;
  if (statusRevisarImagen) customFields.status_revisar_imagen = statusRevisarImagen;
  if (!customFields.fbclid) warnings.push('No se encontró custom field "fbclid"');

  return {
    pipelineId: pipeline.id,
    pipelineName: pipeline.name,
    statuses,
    statusCargo,
    statusRevisarImagen,
    customFields,
    warnings,
  };
}

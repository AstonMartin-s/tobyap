import { getTenantBySlug, updateTenantFields } from '@/lib/tenants';

// Setup estándar de TOBYAP para un cliente, idempotente. Deja: campos custom
// (ad_code, CBU, TITULAR) + etapas estándar del pipeline trackeado + mapeo de
// status_cargo / status_revisar_imagen. No borra nada; solo agrega lo que falta.

// Campos estándar de TODOS los clientes.
const FIELDS = [
  { name: 'ad_code', key: 'ad_code' },
  { name: 'CBU', key: 'cbu_field' },
  { name: 'TITULAR', key: 'titular_field' },
];

// Campos EXCLUSIVOS de la integración Pagoda (dat4win). Solo se crean si el
// cliente la tiene configurada — no se mezclan con los demás clientes.
const PAGODA_FIELDS = [
  { name: 'PORTAL_URL', key: 'portal_url_field' },
  { name: 'PORTAL_USER', key: 'portal_user_field' },
  { name: 'PORTAL_PASS', key: 'portal_pass_field' },
];

// Etapas estándar (nombre, sort, color válido de la paleta de Kommo).
const STAGES = [
  { name: 'Revisar', sort: 20, color: '#fffd7f' },
  { name: 'Pidio Usuario', sort: 30, color: '#98cbff' },
  { name: 'Usuario Creado', sort: 40, color: '#c1e0ff' },
  { name: 'Pidio CbuAlias', sort: 50, color: '#f9deff' },
  { name: 'Revisar imagen', sort: 60, color: '#ffdc7f' },
  { name: 'Cargo$', sort: 70, color: '#87f2c0' },
  { name: 'Seguimiento', sort: 80, color: '#fff000' },
  { name: 'No Atender', sort: 90, color: '#ffc8c8' },
  { name: 'No Cargo', sort: 100, color: '#ffc8c8' },
];

export interface HealReport {
  fieldsCreated: string[];
  stagesCreated: string[];
  mapping: Record<string, number | undefined>;
  warnings: string[];
}

export async function healClient(slug: string): Promise<HealReport> {
  const t = await getTenantBySlug(slug);
  if (!t) throw new Error(`tenant ${slug} no existe`);
  const base = `https://${t.kommoSubdomain}.kommo.com/api/v4/leads`;
  const H = { Authorization: `Bearer ${t.kommoToken}`, 'Content-Type': 'application/json' };
  const cf: Record<string, number> = { ...((t.customFields ?? {}) as Record<string, number>) };
  const rep: HealReport = { fieldsCreated: [], stagesCreated: [], mapping: {}, warnings: [] };

  // Los campos de Pagoda SOLO para clientes con la integración configurada; así
  // no se crean en los Kommos de los demás clientes.
  const usesPagoda = !!(t.pagodaUrl && t.pagodaApiKey);
  const fieldsWanted = usesPagoda ? [...FIELDS, ...PAGODA_FIELDS] : FIELDS;

  // 1) CAMPOS custom
  const fr = await fetch(`${base}/custom_fields?limit=250`, { headers: H });
  const fj = (await fr.json().catch(() => ({}))) as any;
  const byField: Record<string, number> = {};
  for (const f of fj?._embedded?.custom_fields ?? []) byField[String(f.name).toLowerCase()] = f.id;
  const toCreate = fieldsWanted.filter((f) => !byField[f.name.toLowerCase()]);
  if (toCreate.length) {
    const cr = await fetch(`${base}/custom_fields`, { method: 'POST', headers: H, body: JSON.stringify(toCreate.map((f) => ({ name: f.name, type: 'text' }))) });
    const cj = (await cr.json().catch(() => ({}))) as any;
    if (cr.status !== 200) rep.warnings.push(`campos: ${JSON.stringify(cj).slice(0, 200)}`);
    for (const f of cj?._embedded?.custom_fields ?? []) byField[String(f.name).toLowerCase()] = f.id;
    rep.fieldsCreated = toCreate.map((f) => f.name);
  }
  for (const f of fieldsWanted) if (byField[f.name.toLowerCase()]) cf[f.key] = byField[f.name.toLowerCase()];

  // 2) ETAPAS del pipeline trackeado
  if (t.kommoPipelineId) {
    const pr = await fetch(`${base}/pipelines/${t.kommoPipelineId}`, { headers: H });
    const pj = (await pr.json().catch(() => ({}))) as any;
    const byStage: Record<string, number> = {};
    for (const s of pj?._embedded?.statuses ?? []) byStage[s.name] = s.id;
    const missing = STAGES.filter((s) => !byStage[s.name]);
    if (missing.length) {
      const sr = await fetch(`${base}/pipelines/${t.kommoPipelineId}/statuses`, { method: 'POST', headers: H, body: JSON.stringify(missing) });
      const sj = (await sr.json().catch(() => ({}))) as any;
      if (sr.status !== 200) rep.warnings.push(`etapas: ${JSON.stringify(sj).slice(0, 200)}`);
      for (const s of sj?._embedded?.statuses ?? []) byStage[s.name] = s.id;
      rep.stagesCreated = missing.map((s) => s.name);
    }
    if (byStage['Cargo$']) cf.status_cargo = byStage['Cargo$'];
    if (byStage['Revisar imagen']) cf.status_revisar_imagen = byStage['Revisar imagen'];
  } else rep.warnings.push('tenant sin kommoPipelineId — se saltearon las etapas');

  await updateTenantFields(slug, { customFields: cf });
  rep.mapping = {
    ad_code: cf.ad_code, cbu_field: cf.cbu_field, titular_field: cf.titular_field,
    portal_url_field: cf.portal_url_field, portal_user_field: cf.portal_user_field, portal_pass_field: cf.portal_pass_field,
    status_cargo: cf.status_cargo, status_revisar_imagen: cf.status_revisar_imagen,
  };
  return rep;
}

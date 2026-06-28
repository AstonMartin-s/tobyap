// Reescribe los bots de bots-template/ dejándolos LISTOS para importar al Kommo del
// cliente: cambia las URLs de send_hook a nuestros endpoints (+slug) y remapea los
// change_status (IDs de estado del CRM origen -> IDs del embudo del cliente, por NOMBRE).
//
//   npm run adapt-bots -- <slug> <sourceToken> <sourceSubdomain>
//
// <sourceToken>/<sourceSubdomain>: del CRM modelo de donde salieron los bots
// (ej. paybotcrm13). Se usa solo para leer sus nombres de estado y mapear.
// Salida: bots-adapted/<slug>/*.json
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'fs';
import { getTenantBySlug } from '@/lib/tenants';
import { fetchPipelineStatuses } from '@/lib/kommo';

const APP = 'https://tobyap-production.up.railway.app';
const norm = (s: string) => s.trim().toLowerCase();

async function fetchAllStatuses(subdomain: string, token: string) {
  const res = await fetch(`https://${subdomain}.kommo.com/api/v4/leads/pipelines`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Origen pipelines: HTTP ${res.status}`);
  const d = (await res.json()) as { _embedded?: { pipelines?: Array<{ _embedded?: { statuses?: Array<{ id: number; name: string }> } }> } };
  const byId = new Map<number, string>();
  for (const p of d._embedded?.pipelines ?? [])
    for (const s of p._embedded?.statuses ?? []) byId.set(s.id, s.name);
  return byId;
}

async function main() {
  const [slug, sourceToken, sourceSub] = process.argv.slice(2);
  if (!slug || !sourceToken || !sourceSub) {
    console.error('Uso: npm run adapt-bots -- <slug> <sourceToken> <sourceSubdomain>');
    process.exit(1);
  }
  const t = await getTenantBySlug(slug);
  if (!t || !t.kommoPipelineId) {
    console.error(`Tenant "${slug}" no encontrado o sin pipeline.`);
    process.exit(1);
  }

  // Origen: id -> nombre.  Destino: nombre -> id.
  const srcById = await fetchAllStatuses(sourceSub, sourceToken);
  const pipelineId = t.kommoPipelineId;
  const dstStatuses = await fetchPipelineStatuses(t, pipelineId);
  const nameToId = new Map<string, number>();
  for (const s of dstStatuses) nameToId.set(norm(s.name), s.id);

  // old status id -> new status id (por nombre). 142/143 (won/lost) se mantienen.
  function remapStatus(oldId: number): number {
    if (oldId === 142 || oldId === 143) return oldId;
    const name = srcById.get(oldId);
    const newId = name ? nameToId.get(norm(name)) : undefined;
    return newId ?? oldId; // si no matchea, deja el viejo (y avisamos)
  }

  const convUrl = `${APP}/api/conversion-event/${slug}`;
  const cbuUrl = `${APP}/api/cbu/${slug}`;
  const outDir = `bots-adapted/${slug}`;
  mkdirSync(outDir, { recursive: true });
  const warnings: string[] = [];

  // Transforma recursivamente el árbol del flujo: URLs + change_status.
  function walk(node: unknown, file: string): void {
    if (Array.isArray(node)) {
      node.forEach((n) => walk(n, file));
      return;
    }
    if (!node || typeof node !== 'object') return;
    const obj = node as Record<string, unknown>;

    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'string') {
        if (v.includes('/api/conversion-event')) obj[k] = convUrl;
        else if (v.includes('/api/cbu')) obj[k] = cbuUrl;
      } else {
        walk(v, file);
      }
    }

    if (obj.name === 'change_status' && obj.params && typeof obj.params === 'object') {
      const p = obj.params as Record<string, unknown>;
      if (typeof p.value === 'number') {
        const oldId = p.value;
        const newId = remapStatus(oldId);
        if (newId === oldId && oldId !== 142 && oldId !== 143)
          warnings.push(`${file}: estado ${oldId} (${srcById.get(oldId) ?? 'desconocido'}) no se pudo remapear`);
        p.value = newId;
        p.pipeline_id = pipelineId;
      }
    }
  }

  // model.text y model.positions son STRINGS con JSON adentro: parse -> walk -> stringify.
  function transformJsonString(s: string, file: string): string {
    try {
      const parsed = JSON.parse(s);
      walk(parsed, file);
      return JSON.stringify(parsed);
    } catch {
      return s;
    }
  }

  for (const file of readdirSync('bots-template').filter((f) => f.endsWith('.json'))) {
    if (file === 'CREATE_USER.json') continue; // lo dejamos afuera
    const bot = JSON.parse(readFileSync(`bots-template/${file}`, 'utf8'));
    const model = bot.model ?? {};
    if (typeof model.text === 'string') model.text = transformJsonString(model.text, file);
    if (typeof model.positions === 'string') model.positions = transformJsonString(model.positions, file);
    writeFileSync(`${outDir}/${file}`, JSON.stringify(bot, null, 0));
    console.log(`✓ ${file}`);
  }

  if (warnings.length) {
    console.log('\n⚠️  Revisar:');
    [...new Set(warnings)].forEach((w) => console.log('   ' + w));
  }
  console.log(`\nListos en ${outDir}/ — importalos en el diseñador de Salesbot del cliente.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

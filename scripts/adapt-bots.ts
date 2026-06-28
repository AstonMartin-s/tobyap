// Reescribe los bots de bots-template/ dejándolos LISTOS para importar al Kommo del
// cliente: URLs de send_hook -> nuestros endpoints (+slug) y change_status remapeado
// (estado + pipeline) del CRM origen al del cliente, por NOMBRE (tolerante).
//
//   npm run adapt-bots -- <slug> <sourceToken> <sourceSubdomain>
//
// Salida: bots-adapted/<slug>/*.json
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'fs';
import { getTenantBySlug } from '@/lib/tenants';

const APP = 'https://tobyap-production.up.railway.app';
// Normalización tolerante: minúsculas + solo alfanumérico ("Pidio cbu/alias" == "Pidio CbuAlias").
const agg = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

interface Pipe { id: number; name: string; statuses: Array<{ id: number; name: string }> }

async function pipelines(subdomain: string, token: string): Promise<Pipe[]> {
  const res = await fetch(`https://${subdomain}.kommo.com/api/v4/leads/pipelines`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`${subdomain} pipelines: HTTP ${res.status}`);
  const d = (await res.json()) as { _embedded?: { pipelines?: Array<{ id: number; name: string; _embedded?: { statuses?: Array<{ id: number; name: string }> } }> } };
  return (d._embedded?.pipelines ?? []).map((p) => ({ id: p.id, name: p.name, statuses: p._embedded?.statuses ?? [] }));
}

async function main() {
  const [slug, sourceToken, sourceSub] = process.argv.slice(2);
  if (!slug || !sourceToken || !sourceSub) {
    console.error('Uso: npm run adapt-bots -- <slug> <sourceToken> <sourceSubdomain>');
    process.exit(1);
  }
  const t = await getTenantBySlug(slug);
  if (!t || !t.kommoSubdomain || !t.kommoToken) {
    console.error(`Tenant "${slug}" no encontrado o sin credenciales.`);
    process.exit(1);
  }

  const srcPipes = await pipelines(sourceSub, sourceToken);
  const dstPipes = await pipelines(t.kommoSubdomain, t.kommoToken);

  // Origen: statusId -> { name, pipeName }
  const srcById = new Map<number, { name: string; pipeName: string }>();
  for (const p of srcPipes) for (const s of p.statuses) srcById.set(s.id, { name: s.name, pipeName: p.name });

  // Destino: pipeName(agg) -> { id, statusByName(agg) -> id }
  const dstByPipe = new Map<string, { id: number; byName: Map<string, number> }>();
  for (const p of dstPipes) {
    const byName = new Map<string, number>();
    for (const s of p.statuses) byName.set(agg(s.name), s.id);
    dstByPipe.set(agg(p.name), { id: p.id, byName });
  }
  const mainPipe = dstByPipe.get(agg('Embudo de ventas')) ?? [...dstByPipe.values()][0];

  const warnings: string[] = [];
  function remap(oldId: number): { value: number; pipeline_id: number } {
    const src = srcById.get(oldId);
    const targetPipe = (src && dstByPipe.get(agg(src.pipeName))) || mainPipe;
    if (oldId === 142 || oldId === 143) return { value: oldId, pipeline_id: targetPipe.id };
    const newId = src ? targetPipe.byName.get(agg(src.name)) : undefined;
    if (newId == null) {
      warnings.push(`estado ${oldId} (${src?.name ?? 'desconocido'} / ${src?.pipeName ?? '?'}) no se pudo mapear`);
      return { value: oldId, pipeline_id: targetPipe.id };
    }
    return { value: newId, pipeline_id: targetPipe.id };
  }

  const convUrl = `${APP}/api/conversion-event/${slug}`;
  const cbuUrl = `${APP}/api/cbu/${slug}`;

  function walk(node: unknown): void {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== 'object') return;
    const obj = node as Record<string, unknown>;
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'string') {
        if (v.includes('/api/conversion-event')) obj[k] = convUrl;
        else if (v.includes('/api/cbu')) obj[k] = cbuUrl;
      } else walk(v);
    }
    if (obj.name === 'change_status' && obj.params && typeof obj.params === 'object') {
      const p = obj.params as Record<string, unknown>;
      if (typeof p.value === 'number') {
        const r = remap(p.value);
        p.value = r.value;
        p.pipeline_id = r.pipeline_id;
      }
    }
  }
  const transform = (s: string) => {
    try {
      const o = JSON.parse(s);
      walk(o);
      return JSON.stringify(o);
    } catch {
      return s;
    }
  };

  const outDir = `bots-adapted/${slug}`;
  mkdirSync(outDir, { recursive: true });
  for (const file of readdirSync('bots-template').filter((f) => f.endsWith('.json'))) {
    if (file === 'CREATE_USER.json') continue;
    const bot = JSON.parse(readFileSync(`bots-template/${file}`, 'utf8'));
    const m = bot.model ?? {};
    if (typeof m.text === 'string') m.text = transform(m.text);
    if (typeof m.positions === 'string') m.positions = transform(m.positions);
    writeFileSync(`${outDir}/${file}`, JSON.stringify(bot));
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

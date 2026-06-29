// Reescribe los bots de bots-template/ dejándolos LISTOS para importar al Kommo del
// cliente: URLs de send_hook -> nuestros endpoints (+slug) y change_status remapeado
// (estado + pipeline) del CRM origen al del cliente, por NOMBRE (tolerante).
//
//   npm run adapt-bots -- <slug> <sourceToken> <sourceSubdomain>
//
// Salida: bots-adapted/<slug>/*.json
import crypto from 'crypto';
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'fs';
import { getTenantBySlug } from '@/lib/tenants';

// Inyecta al inicio del WELCOME un nodo "Establecer campo" que guarda el primer
// mensaje en ad_code (para capturar el token de atribución). Idempotente.
function injectAdCode(bot: { model: { text: string; positions: string } }, adFieldId: number): void {
  const text = JSON.parse(bot.model.text) as Record<string, unknown>;
  const pos = JSON.parse(bot.model.positions) as Array<Record<string, unknown>>;

  // Formato real de Kommo para "Establecer campo" del lead con el mensaje entrante.
  const action = {
    name: 'set_custom_fields',
    params: { type: 'lead', value: '{{message_text}}', value_type: 'value', custom_field: `{{lead.cf.${adFieldId}}}` },
  };
  // Ya inyectado?
  const exists = pos.some((b) =>
    ((b.actions as Array<Record<string, unknown>>) ?? []).some(
      (a) => ((a.params as Record<string, unknown>)?.params as Record<string, unknown>)?.name === 'set_custom_fields',
    ),
  );
  if (exists) return;

  const start = pos.find((b) => b.type === 'start');
  if (!start || !(start.goto as { block?: number })?.block) return;
  const origBlock = (start.goto as { block: number }).block;
  const origPos = pos.find((b) => b.id === origBlock);
  const origStep = (origPos?.step as number) ?? 0;
  const newId = Math.max(...pos.map((b) => b.id as number)) + 1;
  const newStep = 900;
  const uuid = crypto.randomUUID();

  // model.text: nuevo step con la acción + goto al primer step original.
  text[String(newStep)] = {
    question: [
      { params: action, handler: 'action' },
      { params: { step: origStep, type: 'question' }, handler: 'goto' },
    ],
    block_uuid: uuid,
  };
  // positions: nuevo bloque + reapuntar el start.
  pos.push({
    x: (start.x as number) - 100,
    y: (start.y as number) + 220,
    z: 99,
    id: newId,
    goto: { block: origBlock },
    name: 'Establecer campo',
    step: newStep,
    type: 'question',
    width: 400,
    height: 105,
    actions: [{ id: 9000, sort: 0, links: [], params: { params: action, handler: 'action' } }],
    deletable: true,
    block_uuid: uuid,
  });
  (start.goto as { block: number }).block = newId;

  bot.model.text = JSON.stringify(text);
  bot.model.positions = JSON.stringify(pos);
}

const APP = 'https://tobyap-production.up.railway.app';
// Normalización tolerante: minúsculas + solo alfanumérico ("Pidio cbu/alias" == "Pidio CbuAlias").
const agg = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

interface Pipe { id: number; name: string; statuses: Array<{ id: number; name: string }> }

// Fuentes ESTÁTICAS (sin token): usar con `npm run adapt-bots -- <slug> static <sourceKey>`.
// Datos del CRM modelo, para mapear estados/custom-fields por nombre.
const STATIC_SOURCES: Record<string, { pipelines: Pipe[]; customFields: Record<number, string> }> = {
  publigreenbetmia: {
    pipelines: [
      {
        id: 12293031,
        name: 'Embudo de ventas',
        statuses: [
          { id: 95010507, name: 'Incoming leads' },
          { id: 95010515, name: 'Revisar' },
          { id: 95010511, name: 'Pidio Usuario' },
          { id: 95015083, name: 'Pidio CbuAlias' },
          { id: 95160651, name: 'Revisar imagen' },
          { id: 95015087, name: 'Cargo$' },
          { id: 95010523, name: 'No Atender' },
          { id: 95015091, name: 'No Cargo' },
          { id: 95010519, name: 'Seguimiento' },
        ],
      },
      {
        id: 12293739,
        name: 'Clientes Regulares',
        statuses: [
          { id: 95015095, name: 'Leads Entrantes' },
          { id: 95015099, name: 'Pidio Cbu Alias' },
          { id: 95015103, name: 'Atencion Manual' },
          { id: 95015107, name: 'Tomar decisión' },
          { id: 95015183, name: 'Solicita Retiro' },
        ],
      },
    ],
    customFields: { 752838: 'CBU', 752840: 'TITULAR' },
  },
};

async function pipelines(subdomain: string, token: string): Promise<Pipe[]> {
  const res = await fetch(`https://${subdomain}.kommo.com/api/v4/leads/pipelines`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`${subdomain} pipelines: HTTP ${res.status}`);
  const d = (await res.json()) as { _embedded?: { pipelines?: Array<{ id: number; name: string; _embedded?: { statuses?: Array<{ id: number; name: string }> } }> } };
  return (d._embedded?.pipelines ?? []).map((p) => ({ id: p.id, name: p.name, statuses: p._embedded?.statuses ?? [] }));
}

// Custom fields de leads: id -> nombre.
async function customFields(subdomain: string, token: string): Promise<Map<number, string>> {
  const res = await fetch(`https://${subdomain}.kommo.com/api/v4/leads/custom_fields?limit=250`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const m = new Map<number, string>();
  if (!res.ok) return m;
  const d = (await res.json()) as { _embedded?: { custom_fields?: Array<{ id: number; name: string }> } };
  for (const f of d._embedded?.custom_fields ?? []) m.set(f.id, f.name);
  return m;
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

  // Origen: por token (live) o estático (sin token) si sourceToken === 'static'.
  const staticSrc = sourceToken === 'static' ? STATIC_SOURCES[sourceSub] : undefined;
  if (sourceToken === 'static' && !staticSrc) {
    console.error(`No hay fuente estática para "${sourceSub}". Disponibles: ${Object.keys(STATIC_SOURCES).join(', ')}`);
    process.exit(1);
  }
  const srcPipes = staticSrc ? staticSrc.pipelines : await pipelines(sourceSub, sourceToken);
  const dstPipes = await pipelines(t.kommoSubdomain, t.kommoToken);

  // Custom fields: origen id->nombre, destino nombre(agg)->id.
  const srcCf = staticSrc
    ? new Map<number, string>(Object.entries(staticSrc.customFields).map(([id, n]) => [Number(id), n]))
    : await customFields(sourceSub, sourceToken);
  const dstCf = await customFields(t.kommoSubdomain, t.kommoToken);
  const dstCfByName = new Map<string, number>();
  for (const [id, name] of dstCf) dstCfByName.set(agg(name), id);
  function remapCf(oldId: number): number | null {
    const name = srcCf.get(oldId);
    return name ? dstCfByName.get(agg(name)) ?? null : null;
  }

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
  const retiroUrl = `${APP}/api/retiro/${slug}`;
  const cfWarn: string[] = [];

  function walk(node: unknown): void {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== 'object') return;
    const obj = node as Record<string, unknown>;
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'string') {
        let s = v;
        if (s.includes('/api/conversion-event')) s = convUrl;
        else if (s.includes('/api/cbu')) s = cbuUrl;
        else if (s.includes('/api/retiro')) s = retiroUrl;
        // Remapea {{lead.cf.<id>}} (CBU/Titular u otros) al id del cliente.
        s = s.replace(/\{\{lead\.cf\.(\d+)\}\}/g, (m, id: string) => {
          const n = remapCf(Number(id));
          if (n == null) {
            cfWarn.push(`cf ${id} (${srcCf.get(Number(id)) ?? '?'}) no se pudo mapear`);
            return m;
          }
          return `{{lead.cf.${n}}}`;
        });
        obj[k] = s;
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
    // WELCOME: inyectar el guardado del primer mensaje en ad_code (atribución por token).
    let extra = '';
    if (file === 'WELCOME.json') {
      const adId = t.customFields['ad_code'];
      if (adId) {
        injectAdCode(bot, adId);
        extra = ` (+ ad_code ${adId})`;
      } else {
        cfWarn.push('WELCOME: el tenant no tiene ad_code, no se inyectó el guardado del token');
      }
    }
    writeFileSync(`${outDir}/${file}`, JSON.stringify(bot));
    console.log(`✓ ${file}${extra}`);
  }
  const allWarn = [...new Set([...warnings, ...cfWarn])];
  if (allWarn.length) {
    console.log('\n⚠️  Revisar:');
    allWarn.forEach((w) => console.log('   ' + w));
  }
  console.log(`\nListos en ${outDir}/ — importalos en el diseñador de Salesbot del cliente.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

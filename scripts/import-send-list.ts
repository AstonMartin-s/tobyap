// Importa las listas de envío filtradas (CSV por tier) a la tabla send_list.
// Fallback de atribución por teléfono cuando el lead borra/modifica el token.
//
//   npm run import:send-list -- <slug> <dir> [campaign]
// Ejemplo:
//   npm run import:send-list -- mooneyatkinson docs reactivacion-2026-06-28
//
// Los CSV deben tener columna "Numero" (E.164 con dígitos). El tier se deduce
// del nombre de archivo (whale, vipElite, ... y sus variantes "dormido").
import fs from 'fs';
import path from 'path';
import { sql } from 'drizzle-orm';
import { getTenantBySlug } from '@/lib/tenants';
import { db } from '@/db';
import { sendList } from '@/db/schema';
import { phoneKey, phoneE164 } from '@/lib/phone';

// Nombre de tier (normalizado, sin "dormido") -> ccpp. Un dormido<Tier> usa el
// mismo código que su tier activo.
const TIER_CCPP: Record<string, string> = {
  whale: 'W50',
  vipelite: 'E15',
  vipalto: 'A8',
  valormedio: 'M3',
  bajovalor: 'B1',
};

function ccppFromFilename(file: string): string | null {
  // "dormidoVipAlto_2026-06-28.csv" -> "vipalto"
  const base = path.basename(file).replace(/\.csv$/i, '').replace(/_\d{4}-\d{2}-\d{2}.*$/, '');
  const tier = base.replace(/^dormido/i, '').toLowerCase();
  return TIER_CCPP[tier] ?? null;
}

// Índice de la columna "Numero" en el header.
function numeroIdx(header: string): number {
  const cols = header.split(',').map((c) => c.trim().toLowerCase());
  const i = cols.findIndex((c) => c === 'numero' || c === 'número' || c === 'phone' || c === 'telefono');
  return i;
}

async function main() {
  const [slug, dir, campaign, portalSlug] = process.argv.slice(2);
  if (!slug || !dir) {
    console.error('Uso: npm run import:send-list -- <slug> <dir> [campaign] [portalSlug]');
    process.exit(1);
  }
  const now = new Date(); // enviado_at aproximado (momento de carga)
  const tenant = await getTenantBySlug(slug);
  if (!tenant) {
    console.error(`Tenant "${slug}" no encontrado.`);
    process.exit(1);
  }

  const files = fs.readdirSync(dir).filter((f) => /\.csv$/i.test(f));
  // Dedup global por teléfono (latest-wins): recorremos activos primero para que
  // si un número está en activo y en dormido, gane el que corras último. Acá
  // simplemente el último archivo procesado pisa. Ordenamos alfabético estable.
  const byKey = new Map<string, { phone: string; ccpp: string }>();
  let noCcpp = 0;
  let noPhone = 0;

  for (const file of files.sort()) {
    const ccpp = ccppFromFilename(file);
    if (!ccpp) { console.warn(`(skip) sin tier reconocido: ${file}`); continue; }
    const lines = fs.readFileSync(path.join(dir, file), 'utf8').split(/\r?\n/);
    if (!lines.length) continue;
    const idx = numeroIdx(lines[0]);
    if (idx < 0) { console.warn(`(skip) sin columna Numero: ${file}`); noCcpp++; continue; }
    let rows = 0;
    for (const line of lines.slice(1)) {
      if (!line.trim()) continue;
      const raw = line.split(',')[idx]?.trim();
      const key = phoneKey(raw);
      if (!key) { noPhone++; continue; }
      byKey.set(key, { phone: phoneE164(raw), ccpp });
      rows++;
    }
    console.log(`${file.padEnd(38)} -> ${ccpp}  (${rows} filas)`);
  }

  const entries = [...byKey.entries()];
  console.log(`\nTotal únicos: ${entries.length}  ·  sin teléfono: ${noPhone}`);

  // Upsert en lotes.
  const BATCH = 500;
  let done = 0;
  for (let i = 0; i < entries.length; i += BATCH) {
    const chunk = entries.slice(i, i + BATCH).map(([key, v]) => ({
      tenantId: tenant.id,
      phone: v.phone,
      phoneKey: key,
      ccpp: v.ccpp,
      campaign: campaign ?? null,
      portalSlug: portalSlug ?? null,
      sentAt: now,
    }));
    await db
      .insert(sendList)
      .values(chunk)
      .onConflictDoUpdate({
        target: [sendList.tenantId, sendList.phoneKey],
        // En conflicto no podemos referenciar el valor entrante por fila con esta
        // API; hacemos un segundo pase abajo solo para los que ya existían no es
        // necesario porque el batch ya trae el ccpp correcto vía excluded.
        set: {
          ccpp: sql`excluded.ccpp`,
          campaign: sql`excluded.campaign`,
          portalSlug: sql`excluded.portal_slug`,
          sentAt: sql`excluded.sent_at`,
          updatedAt: new Date(),
        },
      });
    done += chunk.length;
    process.stdout.write(`\rUpsert ${done}/${entries.length}`);
  }
  console.log(`\nListo. ${done} números cargados en send_list para ${slug}.`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });

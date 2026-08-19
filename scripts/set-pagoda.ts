import { readFileSync } from 'fs';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { tenants } from '../db/schema';
import { encrypt } from '../lib/crypto';

// Uso: tsx scripts/set-pagoda.ts <slug> <url> <path-al-archivo-con-la-key>
// La API key se lee de un archivo (no se pasa por argv/consola).
async function main() {
  const [slug, url, keyPath] = process.argv.slice(2);
  if (!slug || !url || !keyPath) {
    throw new Error('uso: tsx scripts/set-pagoda.ts <slug> <url> <keyfile>');
  }
  const key = readFileSync(keyPath, 'utf8').trim();
  const [t] = await db
    .update(tenants)
    .set({ pagodaUrl: url, pagodaApiKey: encrypt(key) })
    .where(eq(tenants.slug, slug))
    .returning({ id: tenants.id, slug: tenants.slug });
  if (!t) throw new Error(`tenant ${slug} no encontrado`);
  console.log(`OK: pagoda configurado para ${t.slug} (${t.id}) url=${url} key=***${key.slice(-4)}`);
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});

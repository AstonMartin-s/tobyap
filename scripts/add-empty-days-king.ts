import { eq, and } from 'drizzle-orm';
import { db } from '@/db';
import { ledger } from '@/db/schema';
import { getTenantBySlug } from '@/lib/tenants';
async function main(){
  const t = await getTenantBySlug('king'); if(!t) throw new Error('no tenant');
  for (const day of ['2026-08-14', '2026-08-15']) {
    const [existing] = await db.select().from(ledger).where(and(eq(ledger.tenantId, t.id), eq(ledger.day, day)));
    if (existing) { console.log(day, 'ya existe, dejo como está:', existing.gasto, existing.ingreso); continue; }
    await db.insert(ledger).values({ tenantId: t.id, day, gasto: 0, ingreso: 0, note: 'sin actividad (día de testeo, datos limpiados)' });
    console.log(day, 'creado en 0');
  }
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1);});

import { and, eq, notInArray, gte } from 'drizzle-orm';
import { db } from '@/db';
import { chatSessions } from '@/db/schema';
import { getTenantBySlug } from '@/lib/tenants';
async function main(){
  const t = await getTenantBySlug('king'); if(!t) throw new Error('no tenant');
  // Solo sesiones reales de HOY (después de la limpieza de datos de prueba), no 'done'/'closed'.
  const since = new Date('2026-08-17T20:00:00.000Z');
  const rows = await db.select().from(chatSessions).where(and(
    eq(chatSessions.tenantId, t.id),
    gte(chatSessions.createdAt, since),
    notInArray(chatSessions.step, ['done', 'closed'])
  ));
  console.log('pendientes:', rows.length);
  for (const r of rows) console.log(' ', r.name, '|', r.phone, '|', r.step, '| lead:', r.kommoLeadId, '|', r.createdAt);
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1);});

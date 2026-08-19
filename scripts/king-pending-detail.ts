import { and, eq, notInArray, gte } from 'drizzle-orm';
import { db } from '@/db';
import { chatSessions } from '@/db/schema';
import { getTenantBySlug } from '@/lib/tenants';
async function main(){
  const t = await getTenantBySlug('king'); if(!t) throw new Error('no tenant');
  const since = new Date('2026-08-17T20:00:00.000Z');
  const rows = await db.select().from(chatSessions).where(and(
    eq(chatSessions.tenantId, t.id), gte(chatSessions.createdAt, since), notInArray(chatSessions.step, ['done', 'closed'])
  ));
  const real = rows.filter(r => !['TestFunnel','VerifyParam'].includes(r.name ?? ''));
  for (const r of real) {
    const data = r.data as any;
    console.log(r.name, '|', r.phone, '| step:', r.step, '| tiene comprobante:', !!data?.comprobante, '| username:', data?.username ?? '-');
  }
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1);});

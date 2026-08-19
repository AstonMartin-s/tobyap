import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { chatSessions } from '@/db/schema';
import { getTenantBySlug } from '@/lib/tenants';
import { fetchKommoLead } from '@/lib/kommo';
async function main(){
  const t = await getTenantBySlug('king'); if(!t) throw new Error('no tenant');
  const [s] = await db.select().from(chatSessions).where(and(eq(chatSessions.tenantId, t.id), eq(chatSessions.sessionKey, 'fb3322b00db0493ded7884cd')));
  console.log('session step:', s.step, '| leadId:', s.kommoLeadId, '| statusCargoId:', t.statusCargoId);
  console.log('cond1 step==validando:', s.step === 'validando');
  console.log('cond2 leadId:', !!s.kommoLeadId);
  console.log('cond3 statusCargoId:', !!t.statusCargoId);
  if (s.step === 'validando' && s.kommoLeadId && t.statusCargoId) {
    try {
      const lead = await fetchKommoLead(t, s.kommoLeadId);
      console.log('fetched status_id:', lead.status_id, '=== cargo?', lead.status_id === t.statusCargoId);
    } catch(e) {
      console.log('FETCH THREW:', e);
    }
  } else {
    console.log('condición NO entrada');
  }
  process.exit(0);
}
main().catch(e=>{console.error('MAIN ERR', e);process.exit(1);});

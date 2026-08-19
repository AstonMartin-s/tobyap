import { and, eq, notInArray, gte, isNull } from 'drizzle-orm';
import { db } from '@/db';
import { chatSessions } from '@/db/schema';
import { getTenantBySlug } from '@/lib/tenants';
import { createChatLead, addLeadNote } from '@/lib/chat/kommoMirror';
import { addLeadTags, updateLeadFields, updateLeadName, updateLeadStatus } from '@/lib/kommo';
import { applyAttributionByCode } from '@/lib/attribution';

async function main() {
  const t = await getTenantBySlug('king'); if (!t) throw new Error('no tenant');
  const since = new Date('2026-08-17T20:00:00.000Z');
  const rows = await db.select().from(chatSessions).where(and(
    eq(chatSessions.tenantId, t.id), gte(chatSessions.createdAt, since),
    notInArray(chatSessions.step, ['done', 'closed']), isNull(chatSessions.kommoLeadId),
  ));
  const real = rows.filter((r) => !['TestFunnel', 'VerifyParam'].includes(r.name ?? ''));
  console.log('a backfillear:', real.length);

  for (const r of real) {
    const data = r.data as Record<string, unknown>;
    const leadId = await createChatLead(t, { phone: r.phone ?? '', name: r.name, token: r.token, campaign: r.campaign });
    if (!leadId) { console.log('  FALLÓ lead para', r.name, r.phone); continue; }

    await db.update(chatSessions).set({ kommoLeadId: leadId }).where(eq(chatSessions.id, r.id));
    addLeadNote(t, leadId, `🌐 Chat web (creado en backfill — el lead original falló al crearse). Tel: ${r.phone}${r.waVerified ? ' (WA ✓)' : ''}`);
    addLeadTags(t, leadId, ['Chat Web']).catch(() => {});
    if (r.token) applyAttributionByCode(t, leadId, r.token).catch(() => null);

    // Si tiene usuario Pagoda, espejamos igual que el flujo normal.
    if (data?.username) {
      const fields: Array<{ fieldId: number; value: string }> = [];
      const uF = t.customFields['portal_url_field'], usF = t.customFields['portal_user_field'], pF = t.customFields['portal_pass_field'];
      if (uF && data.loginUrl) fields.push({ fieldId: uF, value: String(data.loginUrl) });
      if (usF) fields.push({ fieldId: usF, value: String(data.username) });
      if (pF && data.password) fields.push({ fieldId: pF, value: String(data.password) });
      if (fields.length) await updateLeadFields(t, leadId, fields).catch(() => {});
      await updateLeadName(t, leadId, String(data.username)).catch(() => {});
    }

    // Si YA subió comprobante, directo a Revisar imagen para que el operador la vea.
    if (data?.comprobante && t.statusRevisarImagenId) {
      const base = 'https://tobyap-production.up.railway.app';
      const fileUrl = `/api/chat/king/file?sessionKey=${r.sessionKey}`;
      addLeadNote(t, leadId, `📸 Comprobante ya recibido (backfill).\nVerlo: ${base}${fileUrl}\n➡️ Chequealo y mové a Cargo$ para acreditar.`);
      await updateLeadStatus(t, leadId, t.statusRevisarImagenId).catch(() => {});
      console.log('  ', r.name, '-> lead', leadId, '-> REVISAR IMAGEN (tenía comprobante)');
    } else {
      console.log('  ', r.name, '-> lead', leadId);
    }
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

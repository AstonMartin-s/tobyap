import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { getTenantBySlug } from '@/lib/tenants';
import { loadChatRuntime } from '@/lib/chat/loadRuntime';
import { supportMessage, accreditedMessages, onFreeText, stickyWaUrl } from '@/lib/chat/flow';

// Test READ-ONLY: verifica que TODAS las derivaciones a WhatsApp de una sesión
// bblack apunten al MISMO cajero sticky (sin rotación) y que solo se derive
// post-carga. No escribe nada ni llama APIs externas.
//
// Uso: npx tsx --env-file=.env scripts/test-bblack-deriv.ts [slug]
async function main() {
  const slug = process.argv[2] || 'bblack';
  const t = await getTenantBySlug(slug);
  if (!t) throw new Error(`tenant ${slug} no existe`);
  const cfg = await loadChatRuntime(t.id, t.name, null, t.slug);

  // Tomamos una sesión real con cajero asignado.
  const rows = (await db.execute(sql`
    SELECT data->>'assignedWa' AS wa, data->>'assignedWaName' AS name
    FROM chat_sessions
    WHERE tenant_id = ${t.id} AND data->>'assignedWa' IS NOT NULL
    ORDER BY created_at DESC LIMIT 1
  `)) as unknown as Array<{ wa: string; name: string | null }>;
  if (!rows.length) throw new Error('no hay sesiones con assignedWa (¿corriste el backfill?)');

  const assignedWa = rows[0].wa;
  const expected = stickyWaUrl(assignedWa);
  const data = { assignedWa, assignedWaName: rows[0].name, username: 'testuser', loginUrl: null };
  console.log(`\n=== Test derivación ${slug} ===`);
  console.log(`Cajero asignado: ${rows[0].name || assignedWa}  (${assignedWa})`);
  console.log(`wa.me esperado:  ${expected}\n`);

  const checks: Array<{ label: string; wa: string | undefined; wantWa: boolean }> = [];

  // 1) Soporte (botón panel / free-text post-carga)
  const sup = supportMessage(cfg, data);
  checks.push({ label: 'Soporte (post-carga)', wa: sup.find((m) => m.wa)?.wa, wantWa: true });

  // 2) Derivación post-carga (promo cajera)
  const acc = accreditedMessages(null, cfg, data);
  checks.push({ label: 'Derivación post-carga (cajera)', wa: acc.find((m) => m.wa)?.wa, wantWa: true });

  // 3) Pide ayuda PRE-carga (welcome) → NO debe derivar a WhatsApp
  const pre = onFreeText('welcome', 'necesito ayuda', cfg, data);
  checks.push({ label: 'Ayuda PRE-carga (welcome)', wa: pre.find((m) => m.wa)?.wa, wantWa: false });

  // 4) Pide ayuda PRE-carga (comprobante) → NO debe derivar
  const preC = onFreeText('comprobante', 'no puedo, tengo un problema', cfg, data);
  checks.push({ label: 'Ayuda PRE-carga (comprobante)', wa: preC.find((m) => m.wa)?.wa, wantWa: false });

  // 5) Pide ayuda POST-carga (done) → SÍ deriva al cajero
  const post = onFreeText('done', 'necesito ayuda', cfg, data);
  checks.push({ label: 'Ayuda POST-carga (done)', wa: post.find((m) => m.wa)?.wa, wantWa: true });

  let ok = true;
  for (const c of checks) {
    let pass: boolean;
    let detail: string;
    if (c.wantWa) {
      pass = c.wa === expected;
      detail = c.wa ? (pass ? 'OK → cajero sticky' : `MISMATCH → ${c.wa}`) : 'FALTA botón wa';
    } else {
      pass = !c.wa;
      detail = c.wa ? `NO debía derivar → ${c.wa}` : 'OK → sin derivación (se queda en chat)';
    }
    if (!pass) ok = false;
    console.log(`${pass ? '✅' : '❌'} ${c.label}: ${detail}`);
  }

  console.log(`\n${ok ? '✅ TODO OK: derivaciones coordinadas al mismo cajero, solo post-carga.' : '❌ HAY FALLAS (ver arriba).'}\n`);
  process.exit(ok ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });

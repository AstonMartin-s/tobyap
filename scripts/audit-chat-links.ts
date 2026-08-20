/**
 * Audita URLs reales en chats King — muestra qué link se mandó en cada caso.
 * Uso: npx tsx --env-file=.env scripts/audit-chat-links.ts
 */
import { and, desc, eq, ne } from 'drizzle-orm';
import { db } from '@/db';
import { chatSessions } from '@/db/schema';
import { getTenantBySlug } from '@/lib/tenants';

const URL_RE = /https?:\/\/[^\s\])]+/gi;

function urlsInText(text?: string) {
  if (!text) return [];
  return [...text.matchAll(URL_RE)].map((m) => m[0].replace(/[.,;]+$/, ''));
}

function classifyUrl(u: string) {
  if (u.includes('dat4win')) return 'dat4win-magic';
  if (u.includes('greenbet.uno')) return 'greenbet.uno';
  if (u.includes('wa.link') || u.includes('whatsapp')) return 'walink';
  return 'other';
}

async function sampleSessions(
  label: string,
  where: ReturnType<typeof eq> | ReturnType<typeof and>,
  limit = 5,
) {
  const t = await getTenantBySlug('king');
  if (!t) throw new Error('no king tenant');
  const rows = await db
    .select()
    .from(chatSessions)
    .where(and(eq(chatSessions.tenantId, t.id), where))
    .orderBy(desc(chatSessions.updatedAt))
    .limit(limit);

  console.log(`\n=== ${label} (${rows.length}) ===`);
  for (const s of rows) {
    const data = (s.data ?? {}) as Record<string, unknown>;
    const loginUrl = data.loginUrl ? String(data.loginUrl) : null;
    console.log(`--- ${s.name ?? '?'} | step: ${s.step} | stored loginUrl: ${loginUrl ? `${classifyUrl(loginUrl)} ${loginUrl.slice(0, 70)}` : 'none'}`);
    for (const m of s.messages ?? []) {
      if (m.from !== 'bot' || !m.text) continue;
      const urls = urlsInText(m.text);
      if (!urls.length) continue;
      const tag = m.text.includes('Acreditado') || m.text.includes('acreditado') ? '[ACRED]' :
        m.text.includes('Usuario:') || m.text.includes('Contraseña') ? '[CREDS]' :
        m.text.includes('Cargar saldo') ? '[DEPOSIT]' :
        m.text.includes('Retirar') ? '[WITHDRAW]' :
        m.text.includes('Soporte') || m.text.includes('WhatsApp') ? '[SUPPORT]' :
        m.text.includes('datos de acceso') ? '[FORGOT]' : '[LINK]';
      console.log(`  ${tag} ${m.text.replace(/\n/g, ' ').slice(0, 65)}…`);
      for (const u of urls) console.log(`    -> ${classifyUrl(u)} | ${u.slice(0, 90)}`);
    }
  }
}

async function main() {
  await sampleSessions('ACREDITADOS (step=done)', eq(chatSessions.step, 'done'), 5);
  await sampleSessions('NO ACREDITADOS', and(ne(chatSessions.step, 'done'), ne(chatSessions.step, 'closed')), 5);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

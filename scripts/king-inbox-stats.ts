import { eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { chatSessions } from '@/db/schema';
import { getTenantBySlug } from '@/lib/tenants';

async function main() {
  const t = await getTenantBySlug('king');
  if (!t) throw new Error('no king');

  const rows = await db
    .select({
      step: chatSessions.step,
      archived: sql<string>`coalesce(${chatSessions.data} ->> 'archived', 'false')`,
    })
    .from(chatSessions)
    .where(eq(chatSessions.tenantId, t.id));

  let arch = 0;
  let notArch = 0;
  const byStepOpen: Record<string, number> = {};
  const byStepArch: Record<string, number> = {};

  for (const r of rows) {
    const a = r.archived === 'true';
    const st = r.step ?? '?';
    if (a) {
      arch++;
      byStepArch[st] = (byStepArch[st] ?? 0) + 1;
    } else {
      notArch++;
      byStepOpen[st] = (byStepOpen[st] ?? 0) + 1;
    }
  }

  console.log('total sessions:', rows.length);
  console.log('NO archivados (Inbox):', notArch);
  console.log('archivados (auto u manual):', arch);
  console.log('no archivados por step:', byStepOpen);
  console.log(
    'archivados por step:',
    Object.entries(byStepArch)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10),
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

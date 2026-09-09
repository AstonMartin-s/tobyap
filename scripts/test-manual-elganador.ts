// Smoke del modo manual para ElGanador: username + accountStep (sin escribir sesión).
import { accountStep, buildManualUsername } from '@/lib/chat/flow';
import { getTenantBySlug } from '@/lib/tenants';
import { loadChatRuntime } from '@/lib/chat/loadRuntime';
import { randomPlayerPassword } from '@/lib/partner-api';

function check(ok: boolean, label: string) {
  console.log(ok ? `✓ ${label}` : `✗ ${label}`);
  if (!ok) throw new Error(label);
}

async function main() {
  const u = buildManualUsername('juancito', '5491123452882');
  check(u === 'juancito2882', `username juancito+2882 → ${u}`);

  const u2 = buildManualUsername('Juan Cito!', '2882');
  check(u2 === 'juancito2882', `limpia nombre → ${u2}`);

  const pass = randomPlayerPassword();
  check(/^[a-z]{3}[2-9]{3}$/.test(pass), `password formato aaa777 → ${pass}`);

  const t = await getTenantBySlug('elganador');
  if (!t) throw new Error('no encuentro tenant elganador');
  console.log('tenant:', { slug: t.slug, name: t.name, provider: t.provider, readonly: t.readonly, fichas: t.features.fichas });

  const cfg = await loadChatRuntime(t.id, t.name, '5491123452882', t.slug);
  const r = await accountStep(t, { phone: '5491123452882', name: 'juancito' }, cfg);
  check(r.step === 'account_pending', `step=${r.step}`);
  check(r.buttons.length === 0, `sin botones (${r.buttons.length})`);
  check(r.data.suggestedUsername === 'juancito2882', `suggested=${r.data.suggestedUsername}`);
  check(typeof r.data.suggestedPassword === 'string' && String(r.data.suggestedPassword).length === 6, `pass sugerido=${r.data.suggestedPassword}`);
  check(!r.data.username, 'no revela username todavía');
  check((r.messages[0]?.text ?? '').length > 10, `msg: ${(r.messages[0]?.text ?? '').slice(0, 80)}`);

  const again = await accountStep(t, {
    phone: '5491123452882',
    name: 'juancito',
    existing: { username: 'juancito2882', password: 'aaa777' },
  }, cfg);
  check(again.step === 'credenciales', `dedup step=${again.step}`);
  check(again.data.username === 'juancito2882', 'dedup devuelve username existente');
  check(again.buttons.some((b) => b.id === 'want_cbu'), 'dedup trae botón CBU');

  console.log('OK elganador smoke');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });

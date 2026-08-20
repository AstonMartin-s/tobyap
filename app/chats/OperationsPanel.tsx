'use client';
import { useEffect, useState } from 'react';

// Panel de operaciones de SALDO REAL (Partner API — bblack/KingPlay). Autocontenido.
// Se monta SOLO cuando el tenant es provider='partner_api'. Consulta saldo, carga y
// retira fichas. Toda operación de plata pide CONFIRMACIÓN explícita del operario.

type Summary = { cargado: number; retirado: number; balance: number };
type PendingOp = { type: 'deposit' | 'withdraw'; amount: number; bonus: number | null } | null;

const money = (n: number) => `$${(n ?? 0).toLocaleString('es-AR')}`;
const QUICKS = [100, 500, 1000, 5000];
// "" = automático (el server usa el bono de la promo). "0" = sin bono. Nº = fijo.
const BONO_OPTS = [
  { v: '', label: 'Bono: automático (promo)' },
  { v: '0', label: 'Sin bono' },
  { v: '10', label: 'Bono 10%' },
  { v: '20', label: 'Bono 20%' },
  { v: '30', label: 'Bono 30%' },
  { v: '50', label: 'Bono 50%' },
];

export default function OperationsPanel({ sessionKey, onDone }: { sessionKey: string; onDone?: () => void }) {
  const [open, setOpen] = useState(true);
  const [balance, setBalance] = useState<number | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [amount, setAmount] = useState('');
  const [bono, setBono] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [pending, setPending] = useState<PendingOp>(null);

  // Reset al cambiar de chat.
  useEffect(() => { setBalance(null); setSummary(null); setAmount(''); setMsg(null); setPending(null); }, [sessionKey]);

  async function call(op: string, extra?: Record<string, unknown>) {
    const r = await fetch('/api/panel/chats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionKey, op, ...extra }),
    }).then((x) => x.json()).catch(() => null);
    return r;
  }

  async function consult() {
    setBusy(true); setMsg(null);
    const r = await call('pa_balance');
    setBusy(false);
    if (!r?.ok) { setMsg({ kind: 'err', text: r?.error ?? 'no se pudo consultar' }); return; }
    setBalance(typeof r.balance === 'number' ? r.balance : null);
    if (r.summary) setSummary(r.summary);
  }

  useEffect(() => { void consult(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [sessionKey]);

  function ask(type: 'deposit' | 'withdraw') {
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) { setMsg({ kind: 'err', text: 'ingresá un monto válido' }); return; }
    const bonusVal = type === 'deposit' ? (bono === '' ? null : Number(bono)) : null;
    setMsg(null);
    setPending({ type, amount: amt, bonus: bonusVal });
  }

  async function confirm() {
    if (!pending) return;
    setBusy(true);
    const op = pending.type === 'deposit' ? 'pa_deposit' : 'pa_withdraw';
    const extra: Record<string, unknown> = { amount: pending.amount };
    if (pending.type === 'deposit' && pending.bonus != null) extra.bonusPercent = pending.bonus;
    const r = await call(op, extra);
    setBusy(false); setPending(null);
    if (!r?.ok) { setMsg({ kind: 'err', text: r?.error ?? 'la operación falló' }); return; }
    const verb = pending.type === 'deposit' ? 'Cargado' : 'Retirado';
    setMsg({ kind: 'ok', text: `${verb} ${money(pending.amount)}${r.duplicate ? ' (ya estaba registrado)' : ''}. Saldo: ${money(r.balance)}` });
    setAmount('');
    if (typeof r.balance === 'number') setBalance(r.balance);
    await consult();
    onDone?.();
  }

  const box: React.CSSProperties = { border: '1px solid var(--border)', borderRadius: 10, padding: '.6rem .7rem', background: 'var(--card-2, rgba(255,255,255,.02))' };
  const lbl: React.CSSProperties = { fontSize: '.6rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--muted-2,#5d6478)' };

  return (
    <div style={{ ...box, display: 'flex', flexDirection: 'column', gap: '.55rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }} onClick={() => setOpen((o) => !o)}>
        <span style={{ fontSize: '.72rem', fontWeight: 800, color: 'var(--accent,#7c5cff)', display: 'flex', alignItems: 'center', gap: '.35rem' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>
          Panel de operaciones (fichas)
        </span>
        <span style={{ fontSize: '.7rem', color: 'var(--muted)' }}>{open ? '▾' : '▸'}</span>
      </div>

      {open && (
        <>
          {/* Saldo + balance */}
          <div style={{ display: 'flex', gap: '.5rem' }}>
            <div style={{ ...box, flex: 1 }}>
              <div style={lbl}>Saldo actual</div>
              <div style={{ fontSize: '1.05rem', fontWeight: 800 }}>{balance == null ? '—' : money(balance)}</div>
              <button className="tt" data-tt="Consulta el saldo en vivo en la plataforma" disabled={busy} onClick={consult}
                style={{ marginTop: '.25rem', fontSize: '.7rem', padding: '.2rem .5rem', border: '1px solid var(--border)', borderRadius: 6, background: 'transparent', color: 'var(--muted)', cursor: 'pointer' }}>
                ↻ Consultar
              </button>
            </div>
            <div style={{ ...box, flex: 1 }}>
              <div style={lbl}>Balance (panel)</div>
              <div style={{ fontSize: '.72rem', display: 'flex', justifyContent: 'space-between' }}><span>Cargado</span><span style={{ color: '#16a34a', fontWeight: 700 }}>{money(summary?.cargado ?? 0)}</span></div>
              <div style={{ fontSize: '.72rem', display: 'flex', justifyContent: 'space-between' }}><span>Retirado</span><span style={{ color: '#ef4444', fontWeight: 700 }}>{money(summary?.retirado ?? 0)}</span></div>
              <div style={{ fontSize: '.75rem', display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--border)', marginTop: '.2rem', paddingTop: '.2rem', fontWeight: 800 }}><span>Neto</span><span>{money(summary?.balance ?? 0)}</span></div>
            </div>
          </div>

          {/* Monto + quicks + bono */}
          <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <input className="input" inputMode="numeric" placeholder="Monto $" value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ''))}
              style={{ flex: '1 1 90px', padding: '.4rem .6rem', fontSize: '.85rem' }} />
            {QUICKS.map((q) => (
              <button key={q} disabled={busy} onClick={() => setAmount(String((Number(amount) || 0) + q))}
                style={{ fontSize: '.72rem', padding: '.3rem .5rem', border: '1px solid var(--border)', borderRadius: 6, background: 'transparent', color: 'var(--text)', cursor: 'pointer' }}>
                +{q}
              </button>
            ))}
          </div>
          <select className="input" value={bono} onChange={(e) => setBono(e.target.value)} style={{ padding: '.4rem .6rem', fontSize: '.82rem' }}>
            {BONO_OPTS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
          </select>

          {/* Acciones */}
          {!pending ? (
            <div style={{ display: 'flex', gap: '.5rem' }}>
              <button disabled={busy} onClick={() => ask('deposit')} style={{ flex: 1, padding: '.5rem', borderRadius: 8, border: 'none', background: '#16a34a', color: '#fff', fontWeight: 700, fontSize: '.85rem', cursor: 'pointer' }}>+ Cargar</button>
              <button disabled={busy} onClick={() => ask('withdraw')} style={{ flex: 1, padding: '.5rem', borderRadius: 8, border: '1px solid #ef4444', background: 'transparent', color: '#ef4444', fontWeight: 700, fontSize: '.85rem', cursor: 'pointer' }}>− Retirar</button>
            </div>
          ) : (
            <div style={{ ...box, borderColor: pending.type === 'deposit' ? '#16a34a' : '#ef4444', display: 'flex', flexDirection: 'column', gap: '.4rem' }}>
              <div style={{ fontSize: '.82rem', fontWeight: 700 }}>
                ¿Confirmás {pending.type === 'deposit' ? 'CARGAR' : 'RETIRAR'} {money(pending.amount)}
                {pending.type === 'deposit' && pending.bonus != null ? ` + ${pending.bonus}% bono` : ''}
                {pending.type === 'deposit' && pending.bonus == null ? ' (bono automático)' : ''}?
              </div>
              <div style={{ fontSize: '.7rem', color: 'var(--muted)' }}>Mueve saldo real de tu cuenta de agente. No se puede deshacer desde acá.</div>
              <div style={{ display: 'flex', gap: '.5rem' }}>
                <button disabled={busy} onClick={confirm} style={{ flex: 1, padding: '.45rem', borderRadius: 8, border: 'none', background: pending.type === 'deposit' ? '#16a34a' : '#ef4444', color: '#fff', fontWeight: 700, fontSize: '.82rem', cursor: 'pointer' }}>{busy ? 'Procesando…' : 'Sí, confirmar'}</button>
                <button disabled={busy} onClick={() => setPending(null)} style={{ flex: 1, padding: '.45rem', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--muted)', fontWeight: 600, fontSize: '.82rem', cursor: 'pointer' }}>Cancelar</button>
              </div>
            </div>
          )}

          {msg && (
            <div style={{ fontSize: '.75rem', fontWeight: 600, color: msg.kind === 'ok' ? '#16a34a' : '#ef4444' }}>{msg.text}</div>
          )}
        </>
      )}
    </div>
  );
}

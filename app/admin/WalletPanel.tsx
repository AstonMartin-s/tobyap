'use client';

import { useMemo, useState } from 'react';

export type WalletRow = {
  slug: string;
  name: string;
  active: boolean;
  saldo: number;
  wallet: number | null;
};

const money = (n: number) => `$${n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function formatInput(n: number | null): string {
  if (n == null) return '';
  return n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function parseMoney(raw: string): number | null {
  const t = raw.trim().replace(/\$/g, '').replace(/\s/g, '');
  if (!t) return null;
  let s = t;
  if (s.includes(',') && s.includes('.')) {
    s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (s.includes(',')) {
    s = s.replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, '');
  }
  const n = Number(s);
  return Number.isFinite(n) ? +n.toFixed(2) : null;
}

function Diff({ saldo, wallet }: { saldo: number; wallet: number | null }) {
  if (wallet == null) return <span style={{ color: 'var(--muted-2)' }}>—</span>;
  const diff = +(wallet - saldo).toFixed(2);
  if (Math.abs(diff) < 0.01) return <b style={{ color: 'var(--success)' }}>Cuadra</b>;
  if (diff > 0) return <b style={{ color: 'var(--success)' }}>Sobrante {money(diff)}</b>;
  return <b style={{ color: 'var(--danger)' }}>Faltante {money(Math.abs(diff))}</b>;
}

export function WalletPanel({ rows }: { rows: WalletRow[] }) {
  const [items, setItems] = useState(rows);
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(rows.map((r) => [r.slug, formatInput(r.wallet)])),
  );
  const [err, setErr] = useState('');

  const totals = useMemo(() => {
    const saldo = +items.reduce((a, r) => a + r.saldo, 0).toFixed(2);
    const filled = items.filter((r) => r.wallet != null);
    const wallet = +filled.reduce((a, r) => a + (r.wallet ?? 0), 0).toFixed(2);
    const filledSaldo = +filled.reduce((a, r) => a + r.saldo, 0).toFixed(2);
    return {
      saldo,
      wallet,
      filledSaldo,
      missing: items.length - filled.length,
      any: filled.length > 0,
    };
  }, [items]);

  async function save(slug: string) {
    setErr('');
    const wallet = parseMoney(draft[slug] ?? '');
    if ((draft[slug] ?? '').trim() && wallet == null) {
      setErr('Importe inválido');
      return;
    }
    const prev = items.find((r) => r.slug === slug);
    if (prev && prev.wallet === wallet) return;
    const r = await fetch('/api/admin/wallet', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug, wallet }),
    });
    if (!r.ok) {
      setErr('No se pudo guardar');
      return;
    }
    setItems((list) => list.map((row) => (row.slug === slug ? { ...row, wallet } : row)));
    setDraft((d) => ({ ...d, [slug]: formatInput(wallet) }));
  }

  return (
    <aside className="card wallet-rail">
      <div className="card__title">
        Saldo y wallet <span className="card__sub">libro contra lo que hay en la wallet</span>
      </div>
      <div className="wallet-total">
        <div><span>Tienen</span><b>{money(totals.saldo)}</b></div>
        <div><span>En wallet</span><b>{totals.any ? money(totals.wallet) : '—'}</b></div>
        <div><span>Diferencia</span><Diff saldo={totals.filledSaldo} wallet={totals.any ? totals.wallet : null} /></div>
      </div>
      {totals.missing > 0 && totals.any ? (
        <p className="wallet-note">La diferencia de arriba suma solo las wallets cargadas. Faltan {totals.missing}.</p>
      ) : null}
      <div className="wallet-list">
        {items.map((r) => (
          <div className="wallet-row" key={r.slug} style={{ opacity: r.active ? 1 : 0.55 }}>
            <div className="wallet-row__head">
              <b>{r.name}</b>
              <span>{r.slug}</span>
            </div>
            <div className="wallet-row__saldo">Tienen <b>{money(r.saldo)}</b></div>
            <label className="wallet-row__field">
              En wallet
              <input
                className="input"
                inputMode="decimal"
                placeholder="0,00"
                value={draft[r.slug] ?? ''}
                onChange={(e) => setDraft((d) => ({ ...d, [r.slug]: e.target.value }))}
                onBlur={() => void save(r.slug)}
                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
              />
            </label>
            <div className="wallet-row__diff"><Diff saldo={r.saldo} wallet={r.wallet} /></div>
          </div>
        ))}
      </div>
      {err ? <p style={{ color: 'var(--danger)', fontSize: 12, margin: '0.6rem 0 0' }}>{err}</p> : null}
    </aside>
  );
}

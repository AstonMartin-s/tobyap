'use client';

import { useMemo, useState } from 'react';

export type WalletRow = {
  slug: string;
  name: string;
  active: boolean;
  saldo: number;
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

export function WalletPanel({ rows, wallet }: { rows: WalletRow[]; wallet: number | null }) {
  const [saved, setSaved] = useState(wallet);
  const [draft, setDraft] = useState(formatInput(wallet));
  const [err, setErr] = useState('');
  const suma = useMemo(() => +rows.reduce((a, r) => a + r.saldo, 0).toFixed(2), [rows]);
  const diff = saved == null ? null : +(saved - suma).toFixed(2);

  async function save() {
    setErr('');
    const next = parseMoney(draft);
    if (draft.trim() && next == null) {
      setErr('Importe inválido');
      return;
    }
    if (next === saved) return;
    const r = await fetch('/api/admin/wallet', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet: next }),
    });
    if (!r.ok) {
      setErr('No se pudo guardar');
      return;
    }
    setSaved(next);
    setDraft(formatInput(next));
  }

  return (
    <aside className="card wallet-rail">
      <div className="card__title">
        Saldo y wallet <span className="card__sub">detalle y suma</span>
      </div>
      <div className="wallet-sum">
        <span>Suma</span>
        <b>{money(suma)}</b>
      </div>
      <label className="wallet-row__field">
        En wallet
        <input
          className="input"
          inputMode="decimal"
          placeholder="0,00"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => void save()}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        />
      </label>
      <div className="wallet-row__diff">
        {diff == null ? <span style={{ color: 'var(--muted-2)' }}>—</span>
          : Math.abs(diff) < 0.01 ? <b style={{ color: 'var(--success)' }}>Cuadra</b>
            : diff > 0 ? <b style={{ color: 'var(--success)' }}>Sobrante {money(diff)}</b>
              : <b style={{ color: 'var(--danger)' }}>Faltante {money(Math.abs(diff))}</b>}
      </div>
      <div className="wallet-list">
        {rows.map((r) => (
          <div className="wallet-line" key={r.slug} style={{ opacity: r.active ? 1 : 0.55 }}>
            <span>{r.name}</span>
            <b>{money(r.saldo)}</b>
          </div>
        ))}
      </div>
      {err ? <p style={{ color: 'var(--danger)', fontSize: 12, margin: '0.6rem 0 0' }}>{err}</p> : null}
    </aside>
  );
}

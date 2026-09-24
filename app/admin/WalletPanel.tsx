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

  const diffCls = diff == null ? 'none' : Math.abs(diff) < 0.01 ? 'ok' : diff > 0 ? 'up' : 'down';
  const diffLabel = diff == null ? 'Cargá la wallet'
    : Math.abs(diff) < 0.01 ? 'Cuadra'
      : diff > 0 ? `Sobrante ${money(diff)}`
        : `Faltante ${money(Math.abs(diff))}`;

  return (
    <aside className="card wallet-rail">
      <div className="card__title">
        Saldo y wallet <span className="card__sub">detalle y suma</span>
      </div>
      <div className="wallet-head">
        <div className="wallet-metric"><span>Suma clientes</span><b>{money(suma)}</b></div>
        <label className="wallet-field">
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
      </div>
      <div className={`wallet-diff wallet-diff--${diffCls}`}>
        <span>Diferencia</span>
        <b>{diffLabel}</b>
      </div>
      {err ? <p style={{ color: 'var(--danger)', fontSize: 12, margin: '0 0 0.6rem' }}>{err}</p> : null}
      <p className="wallet-list__title">Saldo por cliente</p>
      <div className="wallet-list">
        {rows.map((r) => (
          <div className={`wallet-line${r.active ? '' : ' wallet-line--off'}`} key={r.slug}>
            <span>{r.name}</span>
            <b className={r.saldo < 0 ? 'neg' : undefined}>{money(r.saldo)}</b>
          </div>
        ))}
      </div>
    </aside>
  );
}

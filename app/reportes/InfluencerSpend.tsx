'use client';

import { useCallback, useEffect, useState } from 'react';

interface Row {
  id: string;
  campaign: string;
  day: string;
  amount: number;
  note: string | null;
}

const fmt = (n: number) => n.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

// Editor de gasto de influencers (caja aparte, no afecta el saldo). Solo admin.
// Se carga por campaña (prefijo INFLU) + día. Sirve para calcular el CPA del canal.
export function InfluencerSpend({ start, end }: { start?: string; end?: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [campaign, setCampaign] = useState('INFLU');
  const [day, setDay] = useState(() => new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const qs = new URLSearchParams();
    if (start) qs.set('start', start);
    if (end) qs.set('end', end);
    const r = await fetch(`/api/panel/influencer-spend?${qs}`).then((x) => x.json()).catch(() => ({}));
    setRows(r.rows ?? []);
  }, [start, end]);

  useEffect(() => { load(); }, [load]);

  async function save() {
    setMsg(''); setErr(''); setBusy(true);
    try {
      const res = await fetch('/api/panel/influencer-spend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaign: campaign.trim(), day, amount: Number(amount), note: note.trim() || undefined }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`);
      setMsg('Guardado'); setAmount(''); setNote('');
      await load();
      setTimeout(() => setMsg(''), 2500);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  async function del(id: string) {
    setBusy(true);
    try {
      await fetch(`/api/panel/influencer-spend?id=${id}`, { method: 'DELETE' });
      await load();
    } finally { setBusy(false); }
  }

  const total = rows.reduce((a, r) => a + (r.amount ?? 0), 0);

  return (
    <div className="card">
      <div className="card__title">
        Gasto de influencers <span className="card__sub">en USDT · caja aparte · no afecta tu saldo · solo trazabilidad para el CPA</span>
      </div>

      {msg && <p style={{ color: 'var(--accent)', fontSize: '.85rem' }}>{msg}</p>}
      {err && <p style={{ color: 'var(--danger)', fontSize: '.85rem' }}>{err}</p>}

      <div className="grid-2" style={{ marginBottom: '.6rem' }}>
        <div className="field"><label>Campaña (empieza con INFLU)</label>
          <input className="input" value={campaign} onChange={(e) => setCampaign(e.target.value)} placeholder="INFLUjuan" />
        </div>
        <div className="field"><label>Fecha</label>
          <input className="input" type="date" value={day} onChange={(e) => setDay(e.target.value)} />
        </div>
        <div className="field"><label>Monto (USDT)</label>
          <input className="input" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="150" />
        </div>
        <div className="field"><label>Nota (opcional)</label>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Historia IG @juan" />
        </div>
      </div>
      <div className="row" style={{ marginBottom: '.8rem' }}>
        <button className="btn" disabled={busy} onClick={save}>Guardar gasto</button>
        <span style={{ fontSize: '.82rem', color: 'var(--muted)' }}>Total en el período: <b style={{ color: 'var(--text)' }}>${fmt(total)}</b></span>
      </div>

      <table className="table">
        <thead>
          <tr><th>Fecha</th><th>Campaña</th><th className="num">Monto</th><th>Nota</th><th></th></tr>
        </thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={5} className="empty">Todavía no cargaste gastos de influencers.</td></tr>}
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.day}</td>
              <td>{r.campaign}</td>
              <td className="num">${fmt(r.amount ?? 0)}</td>
              <td>{r.note ?? '—'}</td>
              <td className="num"><button className="btn btn--ghost btn--sm" disabled={busy} onClick={() => del(r.id)}>Borrar</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

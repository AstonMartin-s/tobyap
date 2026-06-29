'use client';

import { useState } from 'react';

export interface DailyRow {
  tenantId: string;
  slug: string;
  name: string;
  day: string;
  chats: number;
  cargas: number;
  gasto: number;
  ingreso: number;
  conversion: number;
  costPerChat: number;
  costPerCarga: number;
  balance: number;
}

const money = (n: number) => `$${n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function save(tenant: string, day: string, gasto: number) {
  const res = await fetch('/api/admin/ledger', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tenant, day, gasto }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Error');
}

function recalc(r: DailyRow): DailyRow {
  return {
    ...r,
    costPerChat: r.chats ? +(r.gasto / r.chats).toFixed(2) : 0,
    costPerCarga: r.cargas ? +(r.gasto / r.cargas).toFixed(2) : 0,
  };
}

export function DailyReportClient({ initial }: { initial: DailyRow[] }) {
  const [rows, setRows] = useState<DailyRow[]>(initial);
  const [saving, setSaving] = useState<string | null>(null);
  const [err, setErr] = useState('');

  const key = (r: DailyRow) => `${r.tenantId}|${r.day}`;

  function setField(k: string, field: 'gasto', value: number) {
    setRows((prev) => prev.map((r) => (key(r) === k ? recalc({ ...r, [field]: value }) : r)));
  }

  async function persist(r: DailyRow) {
    setSaving(key(r)); setErr('');
    try { await save(r.slug, r.day, r.gasto); }
    catch (e) { setErr((e as Error).message); }
    finally { setSaving(null); }
  }

  async function clear(r: DailyRow) {
    setSaving(key(r)); setErr('');
    try {
      await fetch(`/api/admin/ledger?tenant=${r.slug}&day=${r.day}`, { method: 'DELETE' });
      setRows((prev) => prev.map((x) => (key(x) === key(r) ? recalc({ ...x, gasto: 0 }) : x)));
    } catch (e) { setErr((e as Error).message); }
    finally { setSaving(null); }
  }

  const tot = rows.reduce((a, r) => ({ chats: a.chats + r.chats, cargas: a.cargas + r.cargas, gasto: a.gasto + r.gasto }), { chats: 0, cargas: 0, gasto: 0 });
  const convTot = tot.chats ? +(100 * tot.cargas / tot.chats).toFixed(1) : 0;

  if (!rows.length) return <div className="empty">Sin eventos en el período seleccionado.</div>;

  return (
    <>
      {err && <p style={{ color: 'var(--danger)', fontSize: '.85rem', margin: '0 0 .6rem' }}>{err}</p>}
      <table className="table">
        <thead>
          <tr>
            <th>Fecha</th><th>Cliente</th>
            <th className="num">Chats</th><th className="num">$/Chat</th>
            <th className="num">Cargas</th><th className="num">Conv.</th>
            <th className="num">$/Carga</th><th className="num">Gasto</th><th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const k = key(r);
            return (
              <tr key={k}>
                <td style={{ whiteSpace: 'nowrap' }}>{r.day}</td>
                <td>{r.name}<div style={{ color: 'var(--muted)', fontSize: '.75rem' }}>{r.slug}</div></td>
                <td className="num">{r.chats}</td>
                <td className="num">{money(r.costPerChat)}</td>
                <td className="num">{r.cargas}</td>
                <td className="num" style={{ color: 'var(--accent)' }}>{r.conversion}%</td>
                <td className="num">{money(r.costPerCarga)}</td>
                <td className="num">
                  <input className="input input--cell" type="number" step="0.01" value={r.gasto || ''} placeholder="0.00"
                    onChange={(e) => setField(k, 'gasto', Number(e.target.value))}
                    onBlur={() => persist(r)} />
                </td>
                <td className="num" style={{ width: 28 }}>
                  {saving === k ? <span className="spinner" style={{ width: 14, height: 14 }} />
                    : r.gasto ? <button className="btn btn--danger-ghost btn--sm" title="Eliminar gasto" onClick={() => clear(r)}>✕</button> : null}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr style={{ borderTop: '2px solid var(--border-2)', fontWeight: 700 }}>
            <td colSpan={2}>Σ Acumulado</td>
            <td className="num">{tot.chats}</td>
            <td className="num">{money(tot.chats ? tot.gasto / tot.chats : 0)}</td>
            <td className="num">{tot.cargas}</td>
            <td className="num" style={{ color: 'var(--accent)' }}>{convTot}%</td>
            <td className="num">{money(tot.cargas ? tot.gasto / tot.cargas : 0)}</td>
            <td className="num">{money(tot.gasto)}</td>
            <td></td>
          </tr>
        </tfoot>
      </table>
    </>
  );
}

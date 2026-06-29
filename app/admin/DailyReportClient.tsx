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
  recarga: number;
  conversion: number;
  costPerChat: number;
  costPerCarga: number;
  saldo: number;
}

const money = (n: number) => `$${n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function save(tenant: string, day: string, gasto: number, recarga: number) {
  const res = await fetch('/api/admin/ledger', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tenant, day, gasto, ingreso: recarga }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Error');
}

// Saldo de apertura por cliente (antes del primer día visible) = anclado del
// saldo que calculó el server, para poder recalcular en vivo sin perder la
// historia previa al rango mostrado.
function openings(rows: DailyRow[]): Map<string, number> {
  const earliest = new Map<string, DailyRow>();
  for (const r of rows) {
    const cur = earliest.get(r.tenantId);
    if (!cur || r.day < cur.day) earliest.set(r.tenantId, r);
  }
  const m = new Map<string, number>();
  for (const [t, r] of earliest) m.set(t, +(r.saldo - (r.recarga - r.gasto)).toFixed(2));
  return m;
}

function recompute(rows: DailyRow[], opening: Map<string, number>): DailyRow[] {
  const byTenant = new Map<string, DailyRow[]>();
  for (const r of rows) {
    r.costPerChat = r.chats ? +(r.gasto / r.chats).toFixed(2) : 0;
    r.costPerCarga = r.cargas ? +(r.gasto / r.cargas).toFixed(2) : 0;
    const arr = byTenant.get(r.tenantId) ?? [];
    arr.push(r);
    byTenant.set(r.tenantId, arr);
  }
  for (const [t, arr] of byTenant) {
    arr.sort((a, b) => (a.day < b.day ? -1 : 1)); // ascendente para acumular
    let run = opening.get(t) ?? 0;
    for (const r of arr) {
      run = +(run + r.recarga - r.gasto).toFixed(2);
      r.saldo = run;
    }
  }
  return rows;
}

export function DailyReportClient({ initial }: { initial: DailyRow[] }) {
  const [opening] = useState(() => openings(initial));
  const [rows, setRows] = useState<DailyRow[]>(initial);
  const [saving, setSaving] = useState<string | null>(null);
  const [err, setErr] = useState('');

  const key = (r: DailyRow) => `${r.tenantId}|${r.day}`;

  function setField(k: string, field: 'gasto' | 'recarga', value: number) {
    setRows((prev) => recompute(prev.map((r) => (key(r) === k ? { ...r, [field]: value } : r)), opening));
  }

  async function persist(r: DailyRow) {
    setSaving(key(r)); setErr('');
    try { await save(r.slug, r.day, r.gasto, r.recarga); }
    catch (e) { setErr((e as Error).message); }
    finally { setSaving(null); }
  }

  async function clear(r: DailyRow) {
    setSaving(key(r)); setErr('');
    try {
      await fetch(`/api/admin/ledger?tenant=${r.slug}&day=${r.day}`, { method: 'DELETE' });
      setRows((prev) => recompute(prev.map((x) => (key(x) === key(r) ? { ...x, gasto: 0, recarga: 0 } : x)), opening));
    } catch (e) { setErr((e as Error).message); }
    finally { setSaving(null); }
  }

  const tot = rows.reduce((a, r) => ({ chats: a.chats + r.chats, cargas: a.cargas + r.cargas, gasto: a.gasto + r.gasto, recarga: a.recarga + r.recarga }), { chats: 0, cargas: 0, gasto: 0, recarga: 0 });
  const convTot = tot.chats ? +(100 * tot.cargas / tot.chats).toFixed(1) : 0;
  // Saldo final = saldo más reciente (el de la primera fila, orden desc).
  const saldoFinal = rows.length ? rows[0].saldo : 0;

  if (!rows.length) return <div className="empty">Sin eventos ni cargas en el período seleccionado.</div>;

  return (
    <>
      {err && <p style={{ color: 'var(--danger)', fontSize: '.85rem', margin: '0 0 .6rem' }}>{err}</p>}
      <table className="table">
        <thead>
          <tr>
            <th>Fecha</th><th>Cliente</th>
            <th className="num">Chats</th><th className="num">$/Chat</th>
            <th className="num">Cargas</th><th className="num">Conv.</th>
            <th className="num">$/Carga</th><th className="num">Gasto</th>
            <th className="num">Recarga</th><th className="num">Saldo</th><th></th>
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
                <td className="num">
                  <input className="input input--cell" type="number" step="0.01" value={r.recarga || ''} placeholder="0.00"
                    onChange={(e) => setField(k, 'recarga', Number(e.target.value))}
                    onBlur={() => persist(r)} />
                </td>
                <td className="num" style={{ fontWeight: 600, color: r.saldo >= 0 ? 'var(--text)' : 'var(--danger)' }}>{money(r.saldo)}</td>
                <td className="num" style={{ width: 28 }}>
                  {saving === k ? <span className="spinner" style={{ width: 14, height: 14 }} />
                    : (r.gasto || r.recarga) ? <button className="btn btn--danger-ghost btn--sm" title="Eliminar gasto/recarga" onClick={() => clear(r)}>✕</button> : null}
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
            <td className="num">{money(tot.recarga)}</td>
            <td className="num" style={{ color: saldoFinal >= 0 ? 'var(--accent)' : 'var(--danger)' }}>{money(saldoFinal)}</td>
            <td></td>
          </tr>
        </tfoot>
      </table>
    </>
  );
}

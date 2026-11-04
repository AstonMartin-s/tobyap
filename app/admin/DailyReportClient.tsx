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

type Col = { label: string; align: 'left' | 'right'; value: (r: DailyRow) => string; color?: (r: DailyRow) => string };

function reportColumns(): Col[] {
  return [
    { label: 'Fecha', align: 'left', value: (r) => r.day },
    { label: 'Cliente', align: 'left', value: (r) => r.name },
    { label: 'Chats', align: 'right', value: (r) => String(r.chats) },
    { label: '$/Chat', align: 'right', value: (r) => money(r.costPerChat) },
    { label: 'Cargas', align: 'right', value: (r) => String(r.cargas) },
    { label: 'Conv.', align: 'right', value: (r) => `${r.conversion}%`, color: () => '#8eb4ff' },
    { label: '$/Carga', align: 'right', value: (r) => money(r.costPerCarga) },
    { label: 'Gasto', align: 'right', value: (r) => money(r.gasto) },
    { label: 'Recarga', align: 'right', value: (r) => money(r.recarga) },
    { label: 'Saldo', align: 'right', value: (r) => money(r.saldo), color: (r) => (r.saldo >= 0 ? '#e8eef7' : '#f07178') },
  ];
}

function renderReportPng(rows: DailyRow[]): Promise<Blob> {
  const cols = reportColumns();
  const days = rows.map((r) => r.day).sort();
  const names = [...new Set(rows.map((r) => r.name))];
  const title = 'Reportes diarios de ads';
  const subtitle = `${names.join(' · ')} · ${days[0]} → ${days[days.length - 1]}`;
  const tot = rows.reduce((a, r) => ({ chats: a.chats + r.chats, cargas: a.cargas + r.cargas, gasto: a.gasto + r.gasto, recarga: a.recarga + r.recarga }), { chats: 0, cargas: 0, gasto: 0, recarga: 0 });
  const saldoFinal = rows[0]?.saldo ?? 0;
  const foot = ['Σ Acumulado', '', String(tot.chats), money(tot.chats ? tot.gasto / tot.chats : 0), String(tot.cargas), `${tot.chats ? +(100 * tot.cargas / tot.chats).toFixed(1) : 0}%`, money(tot.cargas ? tot.gasto / tot.cargas : 0), money(tot.gasto), money(tot.recarga), money(saldoFinal)];

  const scale = 2;
  const pad = 28;
  const rowH = 36;
  const headH = 40;
  const font = '14px ui-sans-serif, system-ui, sans-serif';
  const fontBold = '700 14px ui-sans-serif, system-ui, sans-serif';
  const measure = document.createElement('canvas').getContext('2d')!;
  measure.font = font;
  const widths = cols.map((col, i) => {
    const cells = [col.label, ...rows.map((r) => col.value(r)), foot[i]];
    const max = Math.max(...cells.map((c) => measure.measureText(c).width));
    return Math.ceil(max) + (col.align === 'left' ? 28 : 22);
  });
  const tableW = widths.reduce((a, b) => a + b, 0);
  const width = tableW + pad * 2;
  const height = pad + 28 + 22 + 16 + headH + rows.length * rowH + rowH + pad;

  const canvas = document.createElement('canvas');
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);
  ctx.fillStyle = '#10161f';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#f4f7fb';
  ctx.font = '700 20px ui-sans-serif, system-ui, sans-serif';
  ctx.fillText(title, pad, pad + 20);
  ctx.fillStyle = '#93a0b4';
  ctx.font = '13px ui-sans-serif, system-ui, sans-serif';
  ctx.fillText(subtitle, pad, pad + 42);

  let y = pad + 58;
  const drawRow = (cells: string[], opts: { header?: boolean; foot?: boolean; colors?: string[] }) => {
    ctx.fillStyle = opts.header ? '#1a2433' : opts.foot ? '#162033' : '#10161f';
    ctx.fillRect(pad, y, tableW, opts.header ? headH : rowH);
    ctx.strokeStyle = '#2a3548';
    ctx.beginPath();
    ctx.moveTo(pad, y + (opts.header ? headH : rowH));
    ctx.lineTo(pad + tableW, y + (opts.header ? headH : rowH));
    ctx.stroke();
    ctx.font = opts.header || opts.foot ? fontBold : font;
    let x = pad;
    cells.forEach((cell, i) => {
      const align = cols[i].align;
      ctx.fillStyle = opts.colors?.[i] || (opts.header ? '#9fb0c6' : '#e8eef7');
      const textX = align === 'right' ? x + widths[i] - 12 : x + 12;
      ctx.textAlign = align;
      ctx.fillText(cell, textX, y + (opts.header ? 26 : 24));
      x += widths[i];
    });
    ctx.textAlign = 'left';
    y += opts.header ? headH : rowH;
  };

  drawRow(cols.map((c) => c.label), { header: true });
  for (const r of rows) {
    drawRow(cols.map((c) => c.value(r)), { colors: cols.map((c) => c.color?.(r) || '#e8eef7') });
  }
  drawRow(foot, {
    foot: true,
    colors: foot.map((_, i) => (i === 5 ? '#8eb4ff' : i === 9 ? (saldoFinal >= 0 ? '#7dffa8' : '#f07178') : '#f4f7fb')),
  });

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('no se pudo armar la imagen'))), 'image/png');
  });
}

async function copyReportImage(rows: DailyRow[]): Promise<'copied' | 'downloaded'> {
  const blob = await renderReportPng(rows);
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    return 'copied';
  } catch {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const day = rows[0]?.day ?? 'reporte';
    a.href = url;
    a.download = `reporte-${rows[0]?.slug ?? 'clientes'}-${day}.png`;
    a.click();
    URL.revokeObjectURL(url);
    return 'downloaded';
  }
}

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
  const [imgState, setImgState] = useState<'idle' | 'busy' | 'copied' | 'downloaded'>('idle');

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
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '.7rem' }}>
        <button
          className="btn btn--ghost btn--sm"
          type="button"
          disabled={imgState === 'busy'}
          onClick={async () => {
            setImgState('busy');
            setErr('');
            try {
              const result = await copyReportImage(rows);
              setImgState(result);
              window.setTimeout(() => setImgState('idle'), 2500);
            } catch (e) {
              setErr((e as Error).message);
              setImgState('idle');
            }
          }}
        >
          {imgState === 'busy' ? 'Armando imagen…' : imgState === 'copied' ? 'Imagen copiada' : imgState === 'downloaded' ? 'Imagen descargada' : 'Copiar tabla como imagen'}
        </button>
      </div>
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

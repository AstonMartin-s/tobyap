'use client';

import { useEffect, useState } from 'react';

type Settings = Record<string, string | null>;
interface NumberRow { id: string; name: string | null; phone: string | null; status: boolean | null; type: string | null }
interface StatusRow { id: string; kommoStatusId: number | null; name: string | null; color: string | null }
interface RuleRow { id: string; rule: string | null; text: string | null; priority: number | null }

const TYPES = ['publi', 'regular', 'spam', 'soporte'];

async function j(url: string, opts?: RequestInit) {
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

export function ConfigClient() {
  return (
    <>
      <div className="page-head">
        <h1>Configuración</h1>
        <p>Gestioná los datos de tu cuenta, números y reglas del CRM.</p>
      </div>
      <SettingsSection />
      <NumbersSection />
      <StatusSection />
      <RulesSection />
    </>
  );
}

// -------------------- Configuración General --------------------
function SettingsSection() {
  const [s, setS] = useState<Settings>({});
  const [msg, setMsg] = useState('');
  const [showCtx, setShowCtx] = useState(false);

  useEffect(() => {
    j('/api/settings').then((d) => setS(d.settings ?? {})).catch(() => {});
  }, []);

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setS((p) => ({ ...p, [k]: e.target.value }));

  async function save() {
    setMsg('Guardando…');
    try {
      await j('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(s) });
      setMsg('✓ Guardado');
      setTimeout(() => setMsg(''), 2500);
    } catch (e) {
      setMsg('Error: ' + (e as Error).message);
    }
  }

  return (
    <section className="card">
      <div className="card__title"><span className="ico">⚙</span> Configuración general</div>
      <div className="grid-2">
        <div className="field">
          <label>Nombre de cuenta (titular)</label>
          <input className="input" value={s.accountName ?? ''} onChange={set('accountName')} placeholder="Titular para el CBU" />
        </div>
        <div className="field">
          <label>CBU / CVU de cuenta</label>
          <input className="input" value={s.accountCbu ?? ''} onChange={set('accountCbu')} placeholder="000000…" />
        </div>
        <div className="field">
          <label>Mensaje de bienvenida / bono</label>
          <input className="input" value={s.message ?? ''} onChange={set('message')} />
        </div>
        <div className="field">
          <label>WhatsApp base (walink)</label>
          <input className="input" value={s.walink ?? ''} onChange={set('walink')} />
        </div>
      </div>

      <div className="field">
        <label style={{ cursor: 'pointer' }} onClick={() => setShowCtx((v) => !v)}>
          Contexto del asistente IA {showCtx ? '▾' : '▸'}
        </label>
        {showCtx && <textarea className="textarea" value={s.context ?? ''} onChange={set('context')} placeholder="Prompt del clasificador…" />}
      </div>

      <div className="row" style={{ marginTop: '0.4rem' }}>
        <button className="btn" onClick={save}>Guardar configuración</button>
        <span style={{ color: 'var(--muted)', fontSize: '0.82rem' }}>{msg}</span>
      </div>
    </section>
  );
}

// -------------------- Números --------------------
function NumbersSection() {
  const [rows, setRows] = useState<NumberRow[]>([]);
  const [form, setForm] = useState({ name: '', phone: '', type: 'publi' });

  const load = () => j('/api/numbers').then((d) => setRows(d.numbers ?? [])).catch(() => {});
  useEffect(() => { load(); }, []);

  async function add() {
    if (!form.phone) return;
    await j('/api/numbers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
    setForm({ name: '', phone: '', type: 'publi' });
    load();
  }
  async function toggle(n: NumberRow) {
    await j('/api/numbers', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: n.id, status: !n.status }) });
    load();
  }
  async function del(id: string) {
    if (!confirm('¿Eliminar número?')) return;
    await j('/api/numbers?id=' + id, { method: 'DELETE' });
    load();
  }

  return (
    <section className="card">
      <div className="card__title"><span className="ico">☎</span> Números de contacto <span className="badge badge--muted">{rows.length}</span></div>
      <table className="table" style={{ marginBottom: '1rem' }}>
        <thead><tr><th>Nombre</th><th>Teléfono</th><th>Tipo</th><th>Estado</th><th></th></tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={5} className="empty">Sin números cargados.</td></tr>}
          {rows.map((n) => (
            <tr key={n.id}>
              <td>{n.name ?? '—'}</td>
              <td style={{ fontVariantNumeric: 'tabular-nums' }}>{n.phone}</td>
              <td><span className="badge badge--type">{n.type ?? '—'}</span></td>
              <td>
                <label className="toggle">
                  <input type="checkbox" checked={!!n.status} onChange={() => toggle(n)} />
                  <span />
                </label>
              </td>
              <td><button className="btn btn--sm btn--danger-ghost" onClick={() => del(n.id)}>Eliminar</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row">
        <input className="input" placeholder="Nombre" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input className="input" placeholder="Teléfono" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        <select className="select" style={{ maxWidth: 140 }} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
          {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <button className="btn" onClick={add}>Agregar</button>
      </div>
    </section>
  );
}

// -------------------- Estados --------------------
function StatusSection() {
  const [rows, setRows] = useState<StatusRow[]>([]);
  const [msg, setMsg] = useState('');

  const load = () => j('/api/status').then((d) => setRows(d.statuses ?? [])).catch(() => {});
  useEffect(() => { load(); }, []);

  async function sync() {
    setMsg('Sincronizando…');
    try {
      const d = await j('/api/status', { method: 'POST' });
      setMsg(`✓ ${d.synced} estados`);
      load();
      setTimeout(() => setMsg(''), 2500);
    } catch (e) { setMsg('Error: ' + (e as Error).message); }
  }

  return (
    <section className="card">
      <div className="card__title" style={{ justifyContent: 'space-between' }}>
        <span><span className="ico">≣</span> Estados del sistema <span className="badge badge--muted">{rows.length}</span></span>
        <span className="row">
          <span style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>{msg}</span>
          <button className="btn btn--ghost btn--sm" onClick={sync}>Sincronizar desde Kommo</button>
        </span>
      </div>
      <table className="table">
        <thead><tr><th>ID Kommo</th><th>Nombre</th><th>Color</th></tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={3} className="empty">Sin estados. Tocá “Sincronizar”.</td></tr>}
          {rows.map((s) => (
            <tr key={s.id}>
              <td style={{ color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>{s.kommoStatusId}</td>
              <td>{s.name}</td>
              <td><span style={{ display: 'inline-block', width: 16, height: 16, borderRadius: 4, background: s.color ?? '#333', border: '1px solid var(--border-2)', verticalAlign: 'middle' }} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

// -------------------- Reglas --------------------
function RulesSection() {
  const [rows, setRows] = useState<RuleRow[]>([]);
  const [form, setForm] = useState({ rule: '', text: '', priority: 1 });

  const load = () => j('/api/rules').then((d) => setRows(d.rules ?? [])).catch(() => {});
  useEffect(() => { load(); }, []);

  async function add() {
    if (!form.rule) return;
    await j('/api/rules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
    setForm({ rule: '', text: '', priority: 1 });
    load();
  }
  async function del(id: string) {
    if (!confirm('¿Eliminar regla?')) return;
    await j('/api/rules?id=' + id, { method: 'DELETE' });
    load();
  }

  return (
    <section className="card">
      <div className="card__title">
        <span className="ico">✦</span> Reglas del clasificador IA
        <span className="badge" style={{ background: 'rgba(255,184,77,0.12)', color: 'var(--warn)' }}>clasificador apagado</span>
      </div>
      <table className="table" style={{ marginBottom: '1rem' }}>
        <thead><tr><th style={{ width: 40 }}>P.</th><th>Regla</th><th>→ Estado</th><th></th></tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={4} className="empty">Sin reglas.</td></tr>}
          {rows.map((r) => (
            <tr key={r.id}>
              <td style={{ color: 'var(--muted)' }}>{r.priority}</td>
              <td>{r.rule}</td>
              <td>{r.text ?? '—'}</td>
              <td><button className="btn btn--sm btn--danger-ghost" onClick={() => del(r.id)}>✕</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row">
        <input className="input" style={{ flex: 2 }} placeholder="Regla (instrucción)" value={form.rule} onChange={(e) => setForm({ ...form, rule: e.target.value })} />
        <input className="input" style={{ flex: 1 }} placeholder="Estado destino" value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} />
        <input className="input" style={{ maxWidth: 70 }} type="number" value={form.priority} onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })} />
        <button className="btn" onClick={add}>Agregar</button>
      </div>
    </section>
  );
}

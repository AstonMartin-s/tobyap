'use client';

import { useEffect, useState } from 'react';

// ---- estilos compartidos ----
const card: React.CSSProperties = {
  border: '1px solid #1c2026',
  borderRadius: 10,
  padding: '1.2rem',
  marginBottom: '1.5rem',
  background: '#101317',
};
const h2: React.CSSProperties = { fontSize: '1rem', margin: '0 0 1rem' };
const input: React.CSSProperties = {
  width: '100%',
  padding: '0.5rem 0.7rem',
  marginBottom: '0.7rem',
  borderRadius: 6,
  border: '1px solid #2a2f36',
  background: '#15181d',
  color: '#e7e9ec',
  boxSizing: 'border-box',
  fontSize: '0.85rem',
};
const label: React.CSSProperties = { fontSize: '0.72rem', color: '#8a93a0', display: 'block', marginBottom: 3 };
const btn: React.CSSProperties = {
  padding: '0.45rem 0.9rem',
  borderRadius: 6,
  border: 'none',
  background: '#25d366',
  color: '#000',
  fontWeight: 700,
  cursor: 'pointer',
  fontSize: '0.82rem',
};
const btnGhost: React.CSSProperties = { ...btn, background: 'transparent', color: '#cfd3d9', border: '1px solid #2a2f36' };
const td: React.CSSProperties = { padding: '0.4rem 0.5rem', fontSize: '0.82rem', borderBottom: '1px solid #1c2026' };
const th: React.CSSProperties = { ...td, color: '#8a93a0', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: 1 };

type Settings = Record<string, string | null>;
interface NumberRow { id: string; name: string | null; phone: string | null; status: boolean | null; type: string | null }
interface StatusRow { id: string; kommoStatusId: number | null; name: string | null; color: string | null }
interface RuleRow { id: string; rule: string | null; text: string | null; priority: number | null; status: string | null }

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
      <h1 style={{ fontSize: '1.3rem', marginBottom: '1.5rem' }}>Configuración</h1>
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

  useEffect(() => {
    j('/api/settings').then((d) => setS(d.settings ?? {})).catch(() => {});
  }, []);

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setS((p) => ({ ...p, [k]: e.target.value }));

  async function save() {
    setMsg('Guardando...');
    try {
      await j('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(s),
      });
      setMsg('✓ Guardado');
    } catch (e) {
      setMsg('Error: ' + (e as Error).message);
    }
  }

  return (
    <section style={card}>
      <h2 style={h2}>Configuración General</h2>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 1rem' }}>
        <div>
          <label style={label}>Nombre de cuenta</label>
          <input style={input} value={s.accountName ?? ''} onChange={set('accountName')} />
        </div>
        <div>
          <label style={label}>CBU de cuenta</label>
          <input style={input} value={s.accountCbu ?? ''} onChange={set('accountCbu')} />
        </div>
        <div>
          <label style={label}>Mensaje de bienvenida / bono</label>
          <input style={input} value={s.message ?? ''} onChange={set('message')} />
        </div>
        <div>
          <label style={label}>Mensaje regulares</label>
          <input style={input} value={s.regularMessage ?? ''} onChange={set('regularMessage')} />
        </div>
        <div>
          <label style={label}>WhatsApp base (walink)</label>
          <input style={input} value={s.walink ?? ''} onChange={set('walink')} />
        </div>
      </div>
      <label style={label}>Contexto del Asistente IA (prompt)</label>
      <textarea style={{ ...input, minHeight: 110, fontFamily: 'inherit' }} value={s.context ?? ''} onChange={set('context')} />
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <button style={btn} onClick={save}>Guardar</button>
        <span style={{ fontSize: '0.8rem', color: '#8a93a0' }}>{msg}</span>
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
    <section style={card}>
      <h2 style={h2}>Números de contacto</h2>
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '1rem' }}>
        <thead><tr><th style={th}>Nombre</th><th style={th}>Teléfono</th><th style={th}>Tipo</th><th style={th}>Estado</th><th style={th}></th></tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td style={{ ...td, color: '#8a93a0' }} colSpan={5}>Sin números.</td></tr>}
          {rows.map((n) => (
            <tr key={n.id}>
              <td style={td}>{n.name ?? '—'}</td>
              <td style={td}>{n.phone}</td>
              <td style={td}>{n.type ?? '—'}</td>
              <td style={td}>
                <button onClick={() => toggle(n)} style={{ ...btnGhost, padding: '0.2rem 0.6rem', color: n.status ? '#7fd99a' : '#ff6b6b' }}>
                  {n.status ? 'Activo' : 'Inactivo'}
                </button>
              </td>
              <td style={td}><button onClick={() => del(n.id)} style={{ ...btnGhost, padding: '0.2rem 0.6rem' }}>✕</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
        <input style={{ ...input, marginBottom: 0 }} placeholder="Nombre" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input style={{ ...input, marginBottom: 0 }} placeholder="Teléfono" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        <select style={{ ...input, marginBottom: 0, width: 130 }} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
          {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <button style={btn} onClick={add}>Agregar</button>
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
    setMsg('Sincronizando...');
    try {
      const d = await j('/api/status', { method: 'POST' });
      setMsg(`✓ ${d.synced} estados`);
      load();
    } catch (e) {
      setMsg('Error: ' + (e as Error).message);
    }
  }

  return (
    <section style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.8rem' }}>
        <h2 style={{ ...h2, margin: 0 }}>Estados del sistema</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
          <span style={{ fontSize: '0.78rem', color: '#8a93a0' }}>{msg}</span>
          <button style={btnGhost} onClick={sync}>Sincronizar desde Kommo</button>
        </div>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr><th style={th}>ID Kommo</th><th style={th}>Nombre</th><th style={th}>Color</th></tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td style={{ ...td, color: '#8a93a0' }} colSpan={3}>Sin estados. Tocá “Sincronizar”.</td></tr>}
          {rows.map((s) => (
            <tr key={s.id}>
              <td style={td}>{s.kommoStatusId}</td>
              <td style={td}>{s.name}</td>
              <td style={td}>
                <span style={{ display: 'inline-block', width: 14, height: 14, borderRadius: 3, background: s.color ?? '#333', verticalAlign: 'middle' }} />
              </td>
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
    <section style={card}>
      <h2 style={h2}>
        Reglas del clasificador IA{' '}
        <span style={{ fontSize: '0.7rem', color: '#ffb84d', fontWeight: 400 }}>· clasificador APAGADO (config disponible)</span>
      </h2>
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '1rem' }}>
        <thead><tr><th style={th}>P.</th><th style={th}>Regla</th><th style={th}>→ Estado</th><th style={th}></th></tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td style={{ ...td, color: '#8a93a0' }} colSpan={4}>Sin reglas.</td></tr>}
          {rows.map((r) => (
            <tr key={r.id}>
              <td style={td}>{r.priority}</td>
              <td style={td}>{r.rule}</td>
              <td style={td}>{r.text ?? '—'}</td>
              <td style={td}><button onClick={() => del(r.id)} style={{ ...btnGhost, padding: '0.2rem 0.6rem' }}>✕</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
        <input style={{ ...input, marginBottom: 0, flex: 2 }} placeholder="Regla (instrucción)" value={form.rule} onChange={(e) => setForm({ ...form, rule: e.target.value })} />
        <input style={{ ...input, marginBottom: 0, flex: 1 }} placeholder="Estado destino" value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} />
        <input style={{ ...input, marginBottom: 0, width: 70 }} type="number" value={form.priority} onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })} />
        <button style={btn} onClick={add}>Agregar</button>
      </div>
    </section>
  );
}

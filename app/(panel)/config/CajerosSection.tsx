'use client';

import { useEffect, useState } from 'react';

type Win = { from: string; to: string };
type Cajero = { id: string; label: string; cbu: string; titular: string; wa: string; schedule: Win[]; fallback?: boolean };

const blank = (n: number): Cajero => ({ id: `c${n}`, label: `Cajero ${n}`, cbu: '', titular: '', wa: '', schedule: [], fallback: false });

export function CajerosSection() {
  const [cajeros, setCajeros] = useState<Cajero[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/panel/cajeros')
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d?.cajeros)) setCajeros(d.cajeros); })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  function upd(i: number, patch: Partial<Cajero>) {
    setCajeros((cs) => cs.map((c, k) => (k === i ? { ...c, ...patch } : c)));
  }
  function setFallback(i: number) {
    setCajeros((cs) => cs.map((c, k) => ({ ...c, fallback: k === i })));
  }
  function addWin(i: number) {
    setCajeros((cs) => cs.map((c, k) => (k === i ? { ...c, schedule: [...c.schedule, { from: '08:00', to: '16:00' }] } : c)));
  }
  function updWin(i: number, wi: number, patch: Partial<Win>) {
    setCajeros((cs) => cs.map((c, k) => (k === i ? { ...c, schedule: c.schedule.map((w, j) => (j === wi ? { ...w, ...patch } : w)) } : c)));
  }
  function delWin(i: number, wi: number) {
    setCajeros((cs) => cs.map((c, k) => (k === i ? { ...c, schedule: c.schedule.filter((_, j) => j !== wi) } : c)));
  }
  function addCajero() {
    setCajeros((cs) => [...cs, blank(cs.length + 1)]);
  }
  function delCajero(i: number) {
    setCajeros((cs) => cs.filter((_, k) => k !== i));
  }

  async function save() {
    setSaving(true); setMsg('');
    try {
      const r = await fetch('/api/panel/cajeros', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cajeros }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || 'error');
      if (Array.isArray(d.cajeros)) setCajeros(d.cajeros);
      setMsg('Guardado ✓'); setTimeout(() => setMsg(''), 2500);
    } catch (e) {
      setMsg('Error: ' + (e as Error).message);
    } finally { setSaving(false); }
  }

  // Feature por presencia: la sección solo aparece en tenants con cajeros
  // configurados (se siembra el primero por DB para activarla). Evita sumar una
  // tarjeta vacía a los demás clientes.
  if (!loaded || cajeros.length === 0) return null;

  return (
    <section className="card">
      <div className="card__title"><span className="ico">💳</span> Cajeros — CBU / WhatsApp por horario</div>
      <p style={{ color: 'var(--muted)', fontSize: '.85rem', marginTop: '-.3rem' }}>
        El chat muestra el CBU y deriva al WhatsApp del cajero cuyo horario cubre la hora actual (Argentina).
        Si ninguna franja cubre el momento, se usa el cajero marcado como <b>por defecto</b>.
      </p>

      {cajeros.length === 0 && <div className="empty">No hay cajeros. Agregá el primero 👇</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '.6rem' }}>
        {cajeros.map((c, i) => (
          <div key={c.id} style={{ border: '1px solid var(--line, rgba(255,255,255,.12))', borderRadius: 12, padding: '.9rem 1rem' }}>
            <div className="row" style={{ alignItems: 'center', gap: '.6rem', marginBottom: '.6rem' }}>
              <input className="input" style={{ maxWidth: 160, fontWeight: 700 }} value={c.label} onChange={(e) => upd(i, { label: e.target.value })} placeholder={`Cajero ${i + 1}`} />
              <label style={{ display: 'flex', alignItems: 'center', gap: '.35rem', fontSize: '.82rem', cursor: 'pointer' }}>
                <input type="radio" name="cajero-fallback" checked={c.fallback === true} onChange={() => setFallback(i)} />
                Por defecto
              </label>
              <button className="btn btn--sm btn--danger-ghost" style={{ marginLeft: 'auto' }} onClick={() => delCajero(i)}>Quitar</button>
            </div>
            <div className="grid-2">
              <div className="field"><label>CBU / CVU / Alias</label><input className="input" value={c.cbu} onChange={(e) => upd(i, { cbu: e.target.value })} placeholder="000000…" /></div>
              <div className="field"><label>Titular</label><input className="input" value={c.titular} onChange={(e) => upd(i, { titular: e.target.value })} placeholder="Nombre del titular" /></div>
              <div className="field"><label>WhatsApp (derivación)</label><input className="input" value={c.wa} onChange={(e) => upd(i, { wa: e.target.value })} placeholder="54911…" /></div>
            </div>
            <div className="field" style={{ marginTop: '.4rem' }}>
              <label>Horarios (desde–hasta, formato HH:MM · 24:00 = medianoche)</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '.4rem' }}>
                {c.schedule.length === 0 && <span style={{ color: 'var(--muted)', fontSize: '.8rem' }}>Sin franjas asignadas.</span>}
                {c.schedule.map((w, wi) => (
                  <div className="row" key={wi} style={{ alignItems: 'center', gap: '.5rem' }}>
                    <input className="input" style={{ maxWidth: 110 }} value={w.from} onChange={(e) => updWin(i, wi, { from: e.target.value })} placeholder="08:00" />
                    <span style={{ color: 'var(--muted)' }}>a</span>
                    <input className="input" style={{ maxWidth: 110 }} value={w.to} onChange={(e) => updWin(i, wi, { to: e.target.value })} placeholder="16:00" />
                    <button className="btn btn--sm btn--danger-ghost" onClick={() => delWin(i, wi)}>✕</button>
                  </div>
                ))}
                <button className="btn btn--sm btn--ghost" style={{ alignSelf: 'flex-start' }} onClick={() => addWin(i)}>+ Agregar franja</button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="row" style={{ marginTop: '.9rem', alignItems: 'center', gap: '.7rem' }}>
        <button className="btn btn--ghost" onClick={addCajero}>+ Agregar cajero</button>
        <button className="btn" onClick={save} disabled={saving}>{saving ? 'Guardando…' : 'Guardar cajeros'}</button>
        {msg && <span style={{ color: msg.startsWith('Error') ? 'var(--danger, #c0392b)' : 'var(--success, #0a9d74)', fontSize: '.85rem' }}>{msg}</span>}
      </div>
    </section>
  );
}

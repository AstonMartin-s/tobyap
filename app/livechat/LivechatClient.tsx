'use client';

import { useEffect, useState } from 'react';

type Brand = { brandName: string; primaryColor: string; avatarUrl: string | null };

export function LivechatClient() {
  const [brand, setBrand] = useState<Brand>({ brandName: '', primaryColor: '#008069', avatarUrl: null });
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch('/api/panel/livechat')
      .then((r) => r.json())
      .then((d) => { if (d.brand) setBrand(d.brand); })
      .catch(() => setMsg('No se pudo leer la config (¿falta columna chat_config en DB?)'));
  }, []);

  async function save() {
    setBusy(true);
    setMsg('Guardando…');
    try {
      const r = await fetch('/api/panel/livechat', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brandName: brand.brandName, primaryColor: brand.primaryColor, avatarUrl: brand.avatarUrl }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? 'error');
      if (d.brand) setBrand(d.brand);
      setMsg('✓ Guardado. El chat del cliente usa esta piel; el guion del bot no cambia.');
    } catch (e) {
      setMsg('Error: ' + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onFile(f: File | null) {
    if (!f) return;
    setBusy(true);
    setMsg('Subiendo foto…');
    try {
      const fd = new FormData();
      fd.append('avatar', f);
      const r = await fetch('/api/panel/livechat', { method: 'POST', body: fd });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? 'error');
      if (d.brand) setBrand(d.brand);
      setMsg('✓ Foto actualizada');
    } catch (e) {
      setMsg('Error: ' + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const initial = (brand.brandName || '?').charAt(0).toUpperCase();

  return (
    <>
      <div className="page-head" style={{ marginBottom: '1rem' }}>
        <div className="page-head__text">
          <h1>Livechat</h1>
          <p>Piel del chat web de este cliente: nombre, color y foto. No cambia lo que dice el bot.</p>
        </div>
      </div>

      {msg && <p style={{ color: 'var(--accent)', fontSize: '.85rem', margin: '0 0 .8rem' }}>{msg}</p>}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 1fr) minmax(280px, 380px)', gap: '1.2rem', alignItems: 'start' }}>
        <section className="card">
          <div className="card__title">Identidad</div>
          <div className="field">
            <label>Nombre que ve el lead</label>
            <input className="input" value={brand.brandName} onChange={(e) => setBrand({ ...brand, brandName: e.target.value })} placeholder="King" />
            <p style={{ color: 'var(--muted)', fontSize: '.78rem', margin: '6px 0 0' }}>Si la app ya está en el celular, el nombre de la pantalla de inicio no se actualiza solo. Borrá el ícono y volvé a “Agregar a inicio”.</p>
          </div>
          <div className="field">
            <label>Color de cabecera</label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="color" value={brand.primaryColor} onChange={(e) => setBrand({ ...brand, primaryColor: e.target.value })} style={{ width: 44, height: 36, border: '1px solid var(--border)', borderRadius: 8, padding: 0, background: 'transparent' }} />
              <input className="input" value={brand.primaryColor} onChange={(e) => setBrand({ ...brand, primaryColor: e.target.value })} style={{ flex: 1 }} />
            </div>
          </div>
          <div className="field">
            <label>Foto de perfil</label>
            <input className="input" value={brand.avatarUrl ?? ''} onChange={(e) => setBrand({ ...brand, avatarUrl: e.target.value || null })} placeholder="https://… o subí un archivo" />
            <input type="file" accept="image/*" disabled={busy} onChange={(e) => onFile(e.target.files?.[0] ?? null)} style={{ marginTop: 8, fontSize: '.8rem' }} />
          </div>
          <button className="btn" disabled={busy} onClick={save} style={{ marginTop: 8 }}>Guardar</button>
        </section>

        <section className="card">
          <div className="card__title">Vista previa</div>
          <div style={{ borderRadius: 12, overflow: 'hidden', border: '1px solid var(--border)', fontFamily: 'system-ui, sans-serif' }}>
            <div style={{ background: brand.primaryColor || '#008069', color: '#fff', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
              {brand.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={brand.avatarUrl} alt="" style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover', background: '#25D366' }} />
              ) : (
                <div style={{ width: 40, height: 40, borderRadius: '50%', background: '#25D366', display: 'grid', placeItems: 'center', fontWeight: 700 }}>{initial}</div>
              )}
              <div>
                <div style={{ fontWeight: 600, fontSize: 16 }}>{brand.brandName || 'Soporte'}</div>
                <div style={{ fontSize: 12, opacity: 0.85 }}>en línea</div>
              </div>
            </div>
            <div style={{ background: '#ECE5DD', padding: 14, minHeight: 120, fontSize: 14, color: '#111' }}>
              El lead ve esta cabecera. Los mensajes del flujo siguen igual.
            </div>
          </div>
        </section>
      </div>
    </>
  );
}

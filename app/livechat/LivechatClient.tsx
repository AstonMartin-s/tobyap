'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  buildConversationPreview,
  DEFAULT_RUNTIME,
  LINK_SLOTS,
  type ChatRuntimeConfig,
  type OfferType,
  type PreviewBubble,
} from '@/lib/chat/runtime';

type Brand = { brandName: string; primaryColor: string; avatarUrl: string | null };

const TABS = [
  { id: 'identidad', label: 'Identidad' },
  { id: 'oferta', label: 'Oferta' },
  { id: 'links', label: 'Links' },
  { id: 'preview', label: 'Vista previa' },
] as const;

type TabId = typeof TABS[number]['id'];

function highlightLinks(text: string, runtime: ChatRuntimeConfig, linkField?: string) {
  const parts: Array<{ t: string; link?: boolean }> = [];
  const urls = linkField === 'supportUrl' ? [runtime.supportUrl] : linkField ? [runtime.portalUrl] : [];
  if (!urls.length || !urls[0]) return [{ t: text }];
  const url = urls[0];
  const idx = text.indexOf(url);
  if (idx < 0) return [{ t: text }];
  if (idx > 0) parts.push({ t: text.slice(0, idx) });
  parts.push({ t: url, link: true });
  if (idx + url.length < text.length) parts.push({ t: text.slice(idx + url.length) });
  return parts;
}

export function LivechatClient() {
  const [tab, setTab] = useState<TabId>('identidad');
  const [brand, setBrand] = useState<Brand>({ brandName: '', primaryColor: '#008069', avatarUrl: null });
  const [runtime, setRuntime] = useState<ChatRuntimeConfig>(DEFAULT_RUNTIME);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const preview = useMemo(() => buildConversationPreview(runtime, 'Martín'), [runtime]);

  useEffect(() => {
    fetch('/api/panel/livechat')
      .then((r) => r.json())
      .then((d) => {
        if (d.brand) setBrand(d.brand);
        if (d.runtime) setRuntime(d.runtime);
      })
      .catch(() => setMsg('No se pudo leer la config (¿falta columna chat_config en DB?)'));
  }, []);

  async function save() {
    setBusy(true);
    setMsg('Guardando…');
    try {
      const r = await fetch('/api/panel/livechat', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brandName: brand.brandName,
          primaryColor: brand.primaryColor,
          avatarUrl: brand.avatarUrl,
          offerType: runtime.offerType,
          offerValue: runtime.offerValue,
          minDeposit: runtime.minDeposit,
          portalUrl: runtime.portalUrl,
          supportUrl: runtime.supportUrl,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? 'error');
      if (d.brand) setBrand(d.brand);
      if (d.runtime) setRuntime(d.runtime);
      setMsg('✓ Guardado. Los chats nuevos usan esta config; King sin cambios hasta guardar.');
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
      if (d.runtime) setRuntime(d.runtime);
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
          <h1>Ajustes de chat</h1>
          <p>Piel del widget + guion configurable (oferta y links). Sin config guardada = valores actuales de King.</p>
        </div>
        <button className="btn" disabled={busy} onClick={save}>Guardar todo</button>
      </div>

      {msg && <p style={{ color: 'var(--accent)', fontSize: '.85rem', margin: '0 0 .8rem' }}>{msg}</p>}

      <div style={{ display: 'flex', gap: '.35rem', marginBottom: '.9rem', flexWrap: 'wrap' }}>
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`btn ${tab === t.id ? '' : 'btn--ghost'}`}
            style={{ padding: '.32rem .75rem', fontSize: '.8rem' }}>
            {t.label}
          </button>
        ))}
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: tab === 'preview'
          ? 'minmax(220px, 280px) minmax(0, 1fr)'
          : 'minmax(280px, 1fr) minmax(300px, 420px)',
        gap: '1.2rem',
        alignItems: 'start',
        width: '100%',
      }}>
        {tab === 'identidad' && (
          <section className="card">
            <div className="card__title">Identidad visual</div>
            <div className="field">
              <label>Nombre que ve el lead</label>
              <input className="input" value={brand.brandName} onChange={(e) => {
                const v = e.target.value;
                setBrand({ ...brand, brandName: v });
                setRuntime({ ...runtime, brandName: v });
              }} placeholder="King" />
              <p style={{ color: 'var(--muted)', fontSize: '.78rem', margin: '6px 0 0' }}>Si la PWA ya está instalada, borrá el ícono y volvé a “Agregar a inicio” para actualizar el nombre.</p>
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
          </section>
        )}

        {tab === 'oferta' && (
          <section className="card">
            <div className="card__title">Oferta promocional</div>
            <div className="field">
              <label>Tipo de promo</label>
              <div style={{ display: 'flex', gap: '.5rem' }}>
                {(['bonus', 'fichas'] as OfferType[]).map((t) => (
                  <button key={t} type="button" onClick={() => setRuntime({ ...runtime, offerType: t })}
                    className={`btn ${runtime.offerType === t ? '' : 'btn--ghost'}`}
                    style={{ padding: '.35rem .8rem', fontSize: '.8rem' }}>
                    {t === 'bonus' ? '% Bono en carga' : 'Fichas gratis'}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <label>{runtime.offerType === 'bonus' ? 'Porcentaje de bono (%)' : 'Cantidad de fichas'}</label>
              <input className="input" type="number" min={1} max={999999}
                value={runtime.offerValue}
                onChange={(e) => setRuntime({ ...runtime, offerValue: Number(e.target.value) || 1 })} />
            </div>
            <div className="field">
              <label>Mínimo de carga ($)</label>
              <input className="input" type="number" min={100} step={100}
                value={runtime.minDeposit}
                onChange={(e) => setRuntime({ ...runtime, minDeposit: Number(e.target.value) || 1000 })} />
            </div>
            <p style={{ color: 'var(--muted)', fontSize: '.78rem', margin: 0 }}>
              Aparece en el mensaje de bienvenida y al pedir el CBU. No afecta la lógica de acreditación en Kommo.
            </p>
          </section>
        )}

        {tab === 'links' && (
          <section className="card">
            <div className="card__title">Links de plataforma</div>
            <p style={{ color: 'var(--muted)', fontSize: '.78rem', margin: '0 0 .8rem' }}>
              Cada link se usa en varios momentos del guion. La vista previa muestra dónde aparece.
            </p>
            <div className="field">
              <label>Portal (login, jugar, cargar, retirar)</label>
              <input className="input" value={runtime.portalUrl} onChange={(e) => setRuntime({ ...runtime, portalUrl: e.target.value })} placeholder="https://greenbet.uno/login" />
              <p style={{ color: 'var(--muted-2)', fontSize: '.72rem', margin: '4px 0 0' }}>
                {LINK_SLOTS.filter((s) => s.field === 'portalUrl').map((s) => s.label).join(' · ')}
              </p>
            </div>
            <div className="field">
              <label>Soporte WhatsApp (walink u otro)</label>
              <input className="input" value={runtime.supportUrl} onChange={(e) => setRuntime({ ...runtime, supportUrl: e.target.value })} placeholder="https://wa.link/…" />
              <p style={{ color: 'var(--muted-2)', fontSize: '.72rem', margin: '4px 0 0' }}>
                {LINK_SLOTS.filter((s) => s.field === 'supportUrl').map((s) => s.label).join(' · ')}
              </p>
            </div>
            <p style={{ color: 'var(--muted)', fontSize: '.75rem', margin: 0 }}>
              El magic-link de Pagoda al acreditar sigue siendo dinámico (one-time). Si no existe, se usa el portal de arriba.
            </p>
          </section>
        )}

        {(tab === 'identidad' || tab === 'oferta' || tab === 'links') && (
          <section className="card">
            <div className="card__title">Cabecera del chat</div>
            <div style={{ borderRadius: 12, overflow: 'hidden', border: '1px solid var(--border)', fontFamily: 'system-ui, sans-serif' }}>
              <div style={{ background: brand.primaryColor || '#008069', color: '#fff', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
                {brand.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={brand.avatarUrl} alt="" style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover', background: '#25D366' }} />
                ) : (
                  <div style={{ width: 40, height: 40, borderRadius: '50%', background: '#25D366', display: 'grid', placeItems: 'center', fontWeight: 700 }}>{initial}</div>
                )}
                <div>
                  <div style={{ fontWeight: 600, fontSize: 16 }}>{brand.brandName || runtime.brandName || 'Soporte'}</div>
                  <div style={{ fontSize: 12, opacity: 0.85 }}>en línea</div>
                </div>
              </div>
              <div style={{ background: '#ECE5DD', padding: 14, minHeight: 80, fontSize: 13, color: '#111' }}>
                Cambios de identidad y oferta se ven acá y en la pestaña Vista previa.
              </div>
            </div>
          </section>
        )}

        {tab === 'preview' && (
          <>
            <section className="card" style={{ alignSelf: 'stretch' }}>
              <div className="card__title">Dónde va cada link</div>
              <p style={{ color: 'var(--muted)', fontSize: '.76rem', margin: '0 0 .7rem', lineHeight: 1.45 }}>
                Los links en <span style={{ color: '#2563eb', fontWeight: 600 }}>azul</span> en la preview salen de la pestaña Links.
              </p>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '.55rem' }}>
                {LINK_SLOTS.map((s) => (
                  <li key={s.id} style={{ fontSize: '.78rem', lineHeight: 1.35, padding: '.45rem .55rem', borderRadius: 8, background: 'var(--bg-2)', border: '1px solid var(--border)' }}>
                    <div style={{ fontWeight: 600, color: 'var(--text)', marginBottom: 2 }}>{s.label}</div>
                    <div style={{ color: 'var(--muted-2)', fontSize: '.7rem', wordBreak: 'break-all' }}>
                      {s.field === 'supportUrl' ? runtime.supportUrl : runtime.portalUrl}
                    </div>
                  </li>
                ))}
              </ul>
              <div style={{ marginTop: '.8rem', padding: '.5rem .55rem', borderRadius: 8, background: 'var(--accent-soft)', fontSize: '.72rem', color: 'var(--muted)' }}>
                Oferta actual: {runtime.offerType === 'bonus' ? `${runtime.offerValue}% bono` : `${runtime.offerValue} fichas`} · mín. ${runtime.minDeposit.toLocaleString('es-AR')}
              </div>
            </section>

            <section className="card" style={{ minWidth: 0 }}>
              <div className="card__title">Conversación modelo</div>
              <p style={{ color: 'var(--muted)', fontSize: '.78rem', margin: '0 0 1rem' }}>
                Así ve el lead el guion completo (ejemplo con Martín).
              </p>
              <div style={{ display: 'flex', justifyContent: 'center', padding: '0 .5rem' }}>
                <div style={{
                  width: '100%',
                  maxWidth: 400,
                  borderRadius: 14,
                  overflow: 'hidden',
                  border: '1px solid var(--border)',
                  boxShadow: '0 12px 40px rgba(0,0,0,.22)',
                  fontFamily: 'system-ui, sans-serif',
                }}>
                  <div style={{ background: brand.primaryColor || '#008069', color: '#fff', padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
                    {brand.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={brand.avatarUrl} alt="" style={{ width: 36, height: 36, borderRadius: '50%', objectFit: 'cover', background: '#25D366' }} />
                    ) : (
                      <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#25D366', display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 14 }}>{initial}</div>
                    )}
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 15 }}>{brand.brandName || runtime.brandName}</div>
                      <div style={{ fontSize: 11, opacity: 0.9 }}>en línea</div>
                    </div>
                  </div>
                  <div style={{
                    background: '#ECE5DD',
                    padding: '12px 10px',
                    minHeight: 420,
                    maxHeight: 'min(62vh, 560px)',
                    overflowY: 'auto',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}>
                    {preview.map((b: PreviewBubble, i: number) => (
                      <div key={i} style={{ alignSelf: b.who === 'user' ? 'flex-end' : 'flex-start', maxWidth: '92%' }}>
                        <div style={{ fontSize: '.58rem', color: '#667', marginBottom: 2, textTransform: 'uppercase', letterSpacing: '.03em' }}>{b.step}</div>
                        <div style={{
                          padding: '7px 10px', borderRadius: 10, fontSize: '.8rem', lineHeight: 1.42, whiteSpace: 'pre-wrap',
                          background: b.who === 'user' ? '#DCF8C6' : '#fff',
                          boxShadow: '0 1px 1px rgba(0,0,0,.1)',
                        }}>
                          {highlightLinks(b.text, runtime, b.linkField).map((p, j) => (
                            <span key={j} style={p.link ? { color: '#2563eb', fontWeight: 600, textDecoration: 'underline', wordBreak: 'break-all' } : undefined}>{p.t}</span>
                          ))}
                        </div>
                        {b.linkField && (
                          <div style={{ fontSize: '.62rem', color: '#2563eb', marginTop: 2 }}>↗ {b.linkField === 'supportUrl' ? 'Link soporte' : 'Link portal'}</div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </section>
          </>
        )}
      </div>
    </>
  );
}

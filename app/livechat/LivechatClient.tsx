'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  buildConversationPreview,
  DEFAULT_RUNTIME,
  LINK_SLOTS,
  PAGODA_MAGIC_URL_SAMPLE,
  type ChatRuntimeConfig,
  type LinkSlotId,
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

function highlightLinks(
  text: string,
  links: ChatRuntimeConfig['links'],
  linkSlot?: LinkSlotId,
  linkMagic?: boolean,
) {
  const parts: Array<{ t: string; link?: boolean }> = [];
  if (!linkSlot) return [{ t: text }];
  const url = linkMagic ? PAGODA_MAGIC_URL_SAMPLE : links[linkSlot];
  if (!url) return [{ t: text }];
  const idx = text.indexOf(url);
  if (idx < 0) return [{ t: text }];
  if (idx > 0) parts.push({ t: text.slice(0, idx) });
  parts.push({ t: url, link: true });
  if (idx + url.length < text.length) parts.push({ t: text.slice(idx + url.length) });
  return parts;
}

function linkSlotLabel(id: LinkSlotId): string {
  return LINK_SLOTS.find((s) => s.id === id)?.label ?? id;
}

function linkBubbleHint(b: PreviewBubble, links: ChatRuntimeConfig['links']): string | null {
  if (!b.linkSlot) return null;
  if (b.linkMagic) return `↗ Magic-link Pagoda (dat4win, único por usuario) · fallback: ${links[b.linkSlot]}`;
  return `↗ ${linkSlotLabel(b.linkSlot)}`;
}

const STATIC_SLOTS = LINK_SLOTS.filter((s) => s.kind === 'static');
const MAGIC_SLOTS = LINK_SLOTS.filter((s) => s.kind === 'magic_fallback');

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
          links: runtime.links,
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
          : tab === 'links'
            ? 'minmax(0, 1fr)'
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
            <div className="card__title">Links por mensaje</div>
            <div style={{ marginBottom: '.9rem', padding: '.55rem .65rem', borderRadius: 8, background: 'var(--blue-soft)', border: '1px solid var(--border)', fontSize: '.74rem', lineHeight: 1.45, color: 'var(--muted)' }}>
              <strong style={{ color: 'var(--text)' }}>Cómo funciona en King (auditado en prod):</strong>
              <ul style={{ margin: '.35rem 0 0', paddingLeft: '1.1rem' }}>
                <li><strong>Credenciales</strong> → siempre <code style={{ fontSize: '.7rem' }}>greenbet.uno/login</code> (página fija).</li>
                <li><strong>Acreditado, Datos, Cargar, Retirar</strong> → magic-link Pagoda <code style={{ fontSize: '.7rem' }}>greenbet.dat4win.com/entrar/…</code> (único por usuario, guardado al crear la cuenta).</li>
                <li><strong>Soporte</strong> → walink configurado abajo.</li>
              </ul>
            </div>

            <p style={{ color: 'var(--muted)', fontSize: '.78rem', margin: '0 0 .65rem', fontWeight: 600 }}>Links fijos (siempre este URL)</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '.85rem', marginBottom: '1rem' }}>
              {STATIC_SLOTS.map((slot) => (
                <div key={slot.id} className="field" style={{ margin: 0 }}>
                  <label style={{ marginBottom: 2 }}>{slot.label}</label>
                  <input
                    className="input"
                    value={runtime.links[slot.id]}
                    onChange={(e) => setRuntime({
                      ...runtime,
                      links: { ...runtime.links, [slot.id]: e.target.value },
                    })}
                    placeholder={slot.id === 'support' ? 'https://wa.link/…' : 'https://greenbet.uno/login'}
                  />
                  <p style={{ color: 'var(--muted-2)', fontSize: '.7rem', margin: '4px 0 0', lineHeight: 1.35 }}>{slot.hint}</p>
                </div>
              ))}
            </div>

            <p style={{ color: 'var(--muted)', fontSize: '.78rem', margin: '0 0 .65rem', fontWeight: 600 }}>Fallback (solo si no hay magic-link Pagoda en la sesión)</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '.85rem' }}>
              {MAGIC_SLOTS.map((slot) => (
                <div key={slot.id} className="field" style={{ margin: 0 }}>
                  <label style={{ marginBottom: 2 }}>{slot.label}</label>
                  <input
                    className="input"
                    value={runtime.links[slot.id]}
                    onChange={(e) => setRuntime({
                      ...runtime,
                      links: { ...runtime.links, [slot.id]: e.target.value },
                    })}
                    placeholder="https://greenbet.uno/login"
                  />
                  <p style={{ color: 'var(--muted-2)', fontSize: '.7rem', margin: '4px 0 0', lineHeight: 1.35 }}>{slot.hint}</p>
                </div>
              ))}
            </div>
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
              <div className="chat-preview-phone" style={{ borderRadius: 0, border: 'none', boxShadow: 'none', padding: 14, minHeight: 80, fontSize: 13 }}>
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
                Azul = URL en el mensaje. Los de <em>dat4win</em> son magic-links Pagoda (dinámicos); el fallback editable está en Links.
              </p>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '.55rem' }}>
                {LINK_SLOTS.map((s) => (
                  <li key={s.id} style={{ fontSize: '.78rem', lineHeight: 1.35, padding: '.45rem .55rem', borderRadius: 8, background: 'var(--bg-2)', border: '1px solid var(--border)' }}>
                    <div style={{ fontWeight: 600, color: 'var(--text)', marginBottom: 2 }}>{s.label}</div>
                    <div style={{ color: 'var(--muted-2)', fontSize: '.68rem', marginBottom: 3 }}>{s.hint}</div>
                    <div style={{ color: 'var(--muted-2)', fontSize: '.7rem', wordBreak: 'break-all' }}>
                      {s.kind === 'magic_fallback' ? (
                        <>
                          <span style={{ color: 'var(--blue)' }}>{PAGODA_MAGIC_URL_SAMPLE}</span>
                          <span style={{ display: 'block', marginTop: 2 }}>fallback: {runtime.links[s.id]}</span>
                        </>
                      ) : runtime.links[s.id]}
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
              <div style={{ display: 'flex', justifyContent: 'flex-start', padding: '0 .25rem' }}>
                <div className="chat-preview-phone" style={{
                  width: '100%',
                  maxWidth: 400,
                  borderRadius: 14,
                  overflow: 'hidden',
                  border: '1px solid #d1d7db',
                  boxShadow: '0 12px 40px rgba(0,0,0,.35)',
                  fontFamily: 'system-ui, -apple-system, sans-serif',
                }}>
                  <div style={{ background: brand.primaryColor || '#008069', color: '#fff', padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
                    {brand.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={brand.avatarUrl} alt="" style={{ width: 36, height: 36, borderRadius: '50%', objectFit: 'cover', background: '#25D366' }} />
                    ) : (
                      <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#25D366', display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 14, color: '#fff' }}>{initial}</div>
                    )}
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 15, color: '#fff' }}>{brand.brandName || runtime.brandName}</div>
                      <div style={{ fontSize: 11, opacity: 0.9, color: '#fff' }}>en línea</div>
                    </div>
                  </div>
                  <div style={{
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
                        <div className="chat-preview-step" style={{ fontSize: '.58rem', marginBottom: 2, textTransform: 'uppercase', letterSpacing: '.03em' }}>{b.step}</div>
                        <div className={`chat-preview-bubble ${b.who === 'user' ? 'chat-preview-bubble--user' : 'chat-preview-bubble--bot'}`} style={{
                          padding: '7px 10px', borderRadius: 10, fontSize: '.8rem', lineHeight: 1.42, whiteSpace: 'pre-wrap',
                          boxShadow: '0 1px 0.5px rgba(0,0,0,.13)',
                        }}>
                          {highlightLinks(b.text, runtime.links, b.linkSlot, b.linkMagic).map((p, j) => (
                            <span key={j} className={p.link ? 'chat-preview-link' : undefined} style={p.link ? { wordBreak: 'break-all' } : undefined}>{p.t}</span>
                          ))}
                        </div>
                        {linkBubbleHint(b, runtime.links) && (
                          <div className="chat-preview-link-hint" style={{ fontSize: '.62rem', marginTop: 2 }}>{linkBubbleHint(b, runtime.links)}</div>
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

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
        <div className="page-head__text">
          <h1>Configuración</h1>
          <p>Gestioná los datos de tu cuenta, números y reglas del CRM.</p>
        </div>
      </div>
      <SettingsSection />
      <LiberadorSection />
      <LandingsSection />
      <NumbersSection />
      <StatusSection />
      <RulesSection />
    </>
  );
}

// -------------------- Liberador de Fichas (Partner API) --------------------
function LiberadorSection() {
  const [url, setUrl] = useState('');
  const [key, setKey] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [providerType, setProviderType] = useState<'partner_api' | 'king'>('partner_api');
  const [sourceId, setSourceId] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    j('/api/settings/liberador').then((d) => {
      setUrl(d.partnerApiUrl ?? '');
      setHasKey(!!d.hasKey);
      const prov = d.provider ?? 'pagoda';
      setEnabled(prov === 'partner_api' || prov === 'king');
      setProviderType(prov === 'king' ? 'king' : 'partner_api');
      if (d.kingSourceId) setSourceId(String(d.kingSourceId));
    }).catch(() => {});
  }, []);

  async function save() {
    setBusy(true); setMsg('Guardando…');
    try {
      await j('/api/settings/liberador', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          partnerApiUrl: url.trim(),
          partnerApiKey: key.trim() || undefined,
          enabled,
          providerType,
          kingSourceId: sourceId.trim() ? Number(sourceId.trim()) : undefined,
        }),
      });
      setMsg('✓ Guardado');
      if (key.trim()) { setHasKey(true); setKey(''); }
      setTimeout(() => setMsg(''), 2500);
    } catch (e) {
      setMsg('Error: ' + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <div className="card__title"><span className="ico">🎰</span> Liberador de Fichas (API de carga)</div>
      <p style={{ color: 'var(--muted)', fontSize: '.82rem', margin: '0 0 .6rem' }}>
        Conecta el panel con la plataforma para cargar/retirar fichas por API. El token es secreto:
        se guarda cifrado y nunca se muestra de vuelta.
      </p>
      <div className="field" style={{ marginBottom: '.5rem' }}>
        <label>Tipo de API</label>
        <select className="input" value={providerType} onChange={(e) => setProviderType(e.target.value as 'partner_api' | 'king')}
          style={{ maxWidth: 260 }}>
          <option value="partner_api">Partner API (bblack)</option>
          <option value="king">King / GreenBet (dat4win)</option>
        </select>
      </div>
      <div className="grid-2">
        <div className="field">
          <label>URL de la API</label>
          <input className="input" value={url} onChange={(e) => setUrl(e.target.value)}
            placeholder={providerType === 'king' ? 'https://greenbet.uno' : 'https://api-…/api/v1'} />
        </div>
        <div className="field">
          <label>Token API {hasKey && <span style={{ color: 'var(--ok,#16a34a)', fontSize: '.72rem' }}>· ✓ configurado</span>}</label>
          <input className="input" type="password" value={key} onChange={(e) => setKey(e.target.value)}
            placeholder={hasKey ? '•••••••• (dejar vacío para no cambiar)' : 'token…'} autoComplete="new-password" />
        </div>
      </div>
      {providerType === 'king' && (
        <div className="field" style={{ maxWidth: 260 }}>
          <label>Source ID (agente)</label>
          <input className="input" value={sourceId} onChange={(e) => setSourceId(e.target.value.replace(/\D/g, ''))}
            placeholder="129161" inputMode="numeric" />
        </div>
      )}
      <label className="field" style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '.5rem', marginTop: '.2rem', cursor: 'pointer' }}>
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        <span>Activar Liberador de Fichas para este cliente <span style={{ color: 'var(--muted)', fontSize: '.78rem' }}>(requiere URL y token{providerType === 'king' ? ' y Source ID' : ''})</span></span>
      </label>
      <div className="row" style={{ marginTop: '0.4rem' }}>
        <button className="btn" onClick={save} disabled={busy}>Guardar</button>
        <span style={{ color: 'var(--muted)', fontSize: '0.82rem' }}>{msg}</span>
      </div>
    </section>
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

// -------------------- Landings --------------------
interface Landing { id: string; landingSlug: string | null; name: string | null; type: string | null; active: boolean | null; config: Record<string, string | number | null> | null }
const LANDING_TYPES = ['publi', 'regular', 'spam', 'remarketing', 'soporte'];

const emptyForm = { landingSlug: '', name: '', type: 'publi', brandName: '', logoUrl: '', primaryColor: '#25d366', waNumber: '', message: '', ccpp: '', campaign: '' };
const cfgStr = (c: Landing['config'], k: string) => (c && c[k] != null ? String(c[k]) : '');

function LandingsSection() {
  const [slug, setSlug] = useState('');
  const [bonos, setBonos] = useState<Record<string, string>>({});
  const [rows, setRows] = useState<Landing[]>([]);
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [n, setN] = useState({ ...emptyForm });
  // Generador de link
  const [gen, setGen] = useState({ landingId: '', ccpp: '', campaign: '' });
  // Dominio público de las landings (no el del panel). Configurable por env.
  const origin = process.env.NEXT_PUBLIC_LANDING_ORIGIN || 'https://go.fichaslibres.online';

  const load = () =>
    j('/api/landings').then((d) => {
      setRows(d.landings ?? []);
      setSlug(d.slug ?? '');
      setBonos(d.bonos ?? {});
      if (d.landings?.length && !gen.landingId) setGen((g) => ({ ...g, landingId: d.landings[0].id }));
    }).catch(() => {});
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const baseUrl = (landingSlug: string | null) => `${origin}/l/${slug}/${landingSlug}`;
  const withParams = (landingSlug: string | null, ccpp: string, campaign: string) => {
    const qs = new URLSearchParams();
    if (ccpp) qs.set('ccpp', ccpp);
    if (campaign) qs.set('campaign', campaign);
    const q = qs.toString();
    return baseUrl(landingSlug) + (q ? `?${q}` : '');
  };

  async function copyText(text: string, label: string) {
    try { await navigator.clipboard.writeText(text); setMsg(`${label} copiado`); setTimeout(() => setMsg(''), 2000); } catch { /* noop */ }
  }
  async function toggle(l: Landing) {
    await j('/api/landings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: l.id, active: !l.active }) });
    load();
  }
  async function del(l: Landing) {
    if (!confirm(`¿Eliminar la landing "${l.name}"?`)) return;
    await j(`/api/landings?id=${l.id}`, { method: 'DELETE' });
    load();
  }
  function startCreate() { setEditId(null); setN({ ...emptyForm }); setOpen(true); }
  function startEdit(l: Landing) {
    setEditId(l.id);
    setN({
      landingSlug: l.landingSlug ?? '', name: l.name ?? '', type: l.type ?? 'publi',
      brandName: cfgStr(l.config, 'brandName'), logoUrl: cfgStr(l.config, 'logoUrl'), primaryColor: cfgStr(l.config, 'primaryColor') || '#25d366',
      waNumber: cfgStr(l.config, 'waNumber'), message: cfgStr(l.config, 'message'), ccpp: cfgStr(l.config, 'ccpp'), campaign: cfgStr(l.config, 'campaign'),
    });
    setOpen(true);
  }
  async function save() {
    setErr('');
    const config = { brandName: n.brandName, logoUrl: n.logoUrl, primaryColor: n.primaryColor, waNumber: n.waNumber, message: n.message, ccpp: n.ccpp, campaign: n.campaign };
    try {
      if (editId) {
        await j('/api/landings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: editId, name: n.name, type: n.type, config }) });
      } else {
        await j('/api/landings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ landingSlug: n.landingSlug, name: n.name || n.landingSlug, type: n.type, config }) });
      }
      setOpen(false); setEditId(null); setN({ ...emptyForm }); load();
    } catch (e) { setErr((e as Error).message); }
  }

  const genLanding = rows.find((r) => r.id === gen.landingId);
  const genUrl = genLanding ? withParams(genLanding.landingSlug, gen.ccpp, gen.campaign) : '';
  const bonoCodes = Object.keys(bonos);

  return (
    <section className="card">
      <div className="card__title">
        <span className="ico">◎</span> Landings <span className="badge badge--muted">{rows.length}</span>
        <span style={{ marginLeft: 'auto' }}><button className="btn btn--sm" onClick={() => (open ? setOpen(false) : startCreate())}>{open ? 'Cancelar' : '+ Nueva landing'}</button></span>
      </div>

      {msg && <p style={{ color: 'var(--accent)', fontSize: '.82rem', margin: '0 0 .6rem' }}>{msg}</p>}

      {open && (
        <div style={{ marginBottom: '1.2rem', paddingBottom: '1.2rem', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontWeight: 600, marginBottom: '.6rem' }}>{editId ? `Editar landing "${n.landingSlug}"` : 'Nueva landing'}</div>
          <div className="grid-2">
            <div className="field"><label>Slug de la landing</label><input className="input" value={n.landingSlug} disabled={!!editId} onChange={(e) => setN({ ...n, landingSlug: e.target.value })} placeholder="promo-verano" /></div>
            <div className="field"><label>Nombre interno</label><input className="input" value={n.name} onChange={(e) => setN({ ...n, name: e.target.value })} /></div>
            <div className="field"><label>Tipo</label><select className="select" value={n.type} onChange={(e) => setN({ ...n, type: e.target.value })}>{LANDING_TYPES.map((x) => <option key={x} value={x}>{x}</option>)}</select></div>
            <div className="field"><label>Marca (texto)</label><input className="input" value={n.brandName} onChange={(e) => setN({ ...n, brandName: e.target.value })} /></div>
            <div className="field"><label>Logo (URL, ej /logos/x.png)</label><input className="input" value={n.logoUrl} onChange={(e) => setN({ ...n, logoUrl: e.target.value })} /></div>
            <div className="field"><label>Color primario</label><input className="input" value={n.primaryColor} onChange={(e) => setN({ ...n, primaryColor: e.target.value })} /></div>
            <div className="field"><label>WhatsApp (con código país)</label><input className="input" value={n.waNumber} onChange={(e) => setN({ ...n, waNumber: e.target.value })} placeholder="5491155550000" /></div>
            <div className="field"><label>CCPP por defecto</label><input className="input" value={n.ccpp} onChange={(e) => setN({ ...n, ccpp: e.target.value })} placeholder="A5" /></div>
            <div className="field"><label>Campaña por defecto</label><input className="input" value={n.campaign} onChange={(e) => setN({ ...n, campaign: e.target.value })} placeholder="C1" /></div>
            <div className="field" style={{ gridColumn: '1 / -1' }}><label>Mensaje de WhatsApp</label><input className="input" value={n.message} onChange={(e) => setN({ ...n, message: e.target.value })} placeholder="Hola, vi el anuncio y quiero mi beneficio" /></div>
          </div>
          {err && <p style={{ color: 'var(--danger)', fontSize: '.85rem' }}>{err}</p>}
          <button className="btn" onClick={save}>{editId ? 'Guardar cambios' : 'Crear landing'}</button>
        </div>
      )}

      <table className="table">
        <thead><tr><th>Landing</th><th>Tipo</th><th>URL base</th><th>Activa</th><th></th></tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={5} className="empty">Sin landings todavía.</td></tr>}
          {rows.map((l) => (
            <tr key={l.id}>
              <td><b>{l.landingSlug}</b><div style={{ color: 'var(--muted)', fontSize: '.75rem' }}>{l.name}</div></td>
              <td><span className="badge badge--type">{l.type}</span></td>
              <td><a href={baseUrl(l.landingSlug)} target="_blank" style={{ color: 'var(--blue)', fontSize: '.8rem' }}>abrir ↗</a></td>
              <td><label className="toggle"><input type="checkbox" checked={!!l.active} onChange={() => toggle(l)} /><span /></label></td>
              <td>
                <button className="btn btn--sm btn--ghost" onClick={() => startEdit(l)}>Editar</button>
                <button className="btn btn--sm btn--danger-ghost" style={{ marginLeft: '.4rem' }} onClick={() => del(l)}>Eliminar</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {rows.length > 0 && (
        <div style={{ marginTop: '1.3rem', paddingTop: '1.1rem', borderTop: '1px solid var(--border)' }}>
          <div style={{ fontWeight: 600, marginBottom: '.7rem' }}>🔗 Generar link con parámetros</div>
          <div className="grid-2">
            <div className="field"><label>Landing</label>
              <select className="select" value={gen.landingId} onChange={(e) => setGen({ ...gen, landingId: e.target.value })}>
                {rows.map((l) => <option key={l.id} value={l.id}>{l.name} ({l.landingSlug})</option>)}
              </select>
            </div>
            <div className="field"><label>CCPP (bono)</label>
              <select className="select" value={gen.ccpp} onChange={(e) => setGen({ ...gen, ccpp: e.target.value })}>
                <option value="">— sin ccpp —</option>
                {bonoCodes.map((code) => <option key={code} value={code}>{code} — {bonos[code]}</option>)}
              </select>
            </div>
            <div className="field" style={{ gridColumn: '1 / -1' }}><label>Campaign (nombre libre)</label><input className="input" value={gen.campaign} onChange={(e) => setGen({ ...gen, campaign: e.target.value.trim() })} placeholder="C1" /></div>
          </div>
          <div className="field">
            <label>URL generada</label>
            <div className="row">
              <input className="input" readOnly value={genUrl} onFocus={(e) => e.currentTarget.select()} style={{ flex: 1 }} />
              <button className="btn" onClick={() => copyText(genUrl, 'Link')}>Copiar</button>
              <a className="btn btn--ghost" href={genUrl} target="_blank">Abrir</a>
            </div>
          </div>
        </div>
      )}
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
        <span className="badge badge--warn">clasificador apagado</span>
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

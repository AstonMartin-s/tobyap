'use client';

import { useEffect, useState } from 'react';

async function j(url: string, opts?: RequestInit) {
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

interface TenantInfo {
  slug: string;
  name: string;
  panelUser: string | null;
  eventSuffix: string | null;
  readonly: boolean;
  allowTags: boolean;
  active: boolean;
  kommoSubdomain: string | null;
  kommoPipelineId: number | null;
  metaPixelId: string | null;
  hasMetaToken: boolean;
  hasKommoToken: boolean;
  customFields: Record<string, number>;
}
interface Landing {
  id: string;
  landingSlug: string | null;
  name: string | null;
  type: string | null;
  active: boolean | null;
  config: Record<string, string | number | null> | null;
}

const LANDING_TYPES = ['publi', 'regular', 'spam', 'remarketing', 'soporte'];

export function ManageClient({ slug }: { slug: string }) {
  const [t, setT] = useState<TenantInfo | null>(null);
  const [landings, setLandings] = useState<Landing[]>([]);
  const [bonos, setBonos] = useState<Record<string, string>>({});
  const [settings, setSettings] = useState<{ accountName?: string | null; accountCbu?: string | null; message?: string | null } | null>(null);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  // Campos editables del tenant
  const [edit, setEdit] = useState({ name: '', eventSuffix: '', metaPixelId: '', metaCapiToken: '', kommoToken: '', panelUser: '', panelPassword: '', maxOp: '' });

  async function load() {
    try {
      const d = await j(`/api/admin/tenant/${slug}`);
      setT(d.tenant);
      setLandings(d.landings ?? []);
      setBonos(d.bonos ?? {});
      setSettings(d.settings ?? {});
      setEdit((p) => ({
        ...p,
        name: d.tenant.name ?? '',
        eventSuffix: d.tenant.eventSuffix ?? '',
        metaPixelId: d.tenant.metaPixelId ?? '',
        panelUser: d.tenant.panelUser ?? '',
        panelPassword: '',
        maxOp: d.tenant.customFields?.max_op_ars ? String(d.tenant.customFields.max_op_ars) : '',
      }));
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [slug]);

  async function patch(body: Record<string, unknown>, ok = 'Guardado') {
    setMsg(''); setErr('');
    try {
      await j(`/api/admin/tenant/${slug}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      setMsg(ok); await load();
      setTimeout(() => setMsg(''), 2500);
    } catch (e) { setErr((e as Error).message); }
  }

  if (!t) return <div className="empty">{err || 'Cargando…'}</div>;

  return (
    <>
      <div className="page-head">
        <div className="page-head__text">
          <h1>{t.name} <span style={{ color: 'var(--muted)', fontWeight: 400, fontSize: '1rem' }}>· {t.slug}</span></h1>
          <p>Gestión del cliente: credenciales, estado y landings.</p>
        </div>
        <div className="page-head__actions">
          <a className="btn btn--ghost btn--sm" href="/admin/clientes">← Clientes</a>
        </div>
      </div>

      {msg && <p style={{ color: 'var(--accent)', fontSize: '.85rem' }}>{msg}</p>}
      {err && <p style={{ color: 'var(--danger)', fontSize: '.85rem' }}>{err}</p>}

      <div className="card">
        <div className="card__title">Estado</div>
        <div className="row" style={{ gap: '2rem', flexWrap: 'wrap' }}>
          <div className="row">
            <label className="toggle"><input type="checkbox" checked={t.active} onChange={(e) => patch({ active: e.target.checked })} /><span /></label>
            <span style={{ fontSize: '.85rem', color: 'var(--muted)' }}>Activo</span>
          </div>
          <div className="row">
            <label className="toggle"><input type="checkbox" checked={t.readonly} onChange={(e) => patch({ readonly: e.target.checked })} /><span /></label>
            <span style={{ fontSize: '.85rem', color: 'var(--muted)' }}>Solo lectura</span>
          </div>
          <div className="row">
            <label className="toggle"><input type="checkbox" checked={t.allowTags} onChange={(e) => patch({ allowTags: e.target.checked })} /><span /></label>
            <span style={{ fontSize: '.85rem', color: 'var(--muted)' }}>Permitir etiquetas (aún en solo-lectura)</span>
          </div>
          <div style={{ fontSize: '.82rem', color: 'var(--muted)' }}>
            Pipeline <b>{t.kommoPipelineId ?? '—'}</b> · Campos {Object.keys(t.customFields).length} · Kommo {t.hasKommoToken ? '🔑' : '—'} · Meta {t.hasMetaToken ? '🔑' : '—'}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card__title">Funciones (solapas opcionales) <span className="card__sub">se muestran/ocultan por cliente · Chats, Configuración y Usuarios son fijos</span></div>
        <div className="row" style={{ gap: '2rem', flexWrap: 'wrap' }}>
          {([
            ['feat_reportes', 'Reportes'],
            ['feat_embudo', 'Embudo'],
            ['feat_livechat', 'Ajustes chat'],
            ['feat_fichas', 'Panel de fichas'],
          ] as const).map(([key, label]) => {
            const on = t.customFields[key] !== 0;
            return (
              <div className="row" key={key}>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={(e) => patch({ customFields: { ...t.customFields, [key]: e.target.checked ? 1 : 0 } })}
                  />
                  <span />
                </label>
                <span style={{ fontSize: '.85rem', color: 'var(--muted)' }}>{label}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="card">
        <div className="card__title">Datos y credenciales <span className="card__sub">dejá un secreto vacío para no cambiarlo</span></div>
        <div className="grid-2">
          <div className="field"><label>Nombre</label><input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></div>
          <div className="field"><label>Event suffix</label><input className="input" value={edit.eventSuffix} onChange={(e) => setEdit({ ...edit, eventSuffix: e.target.value })} /></div>
          <div className="field"><label>Meta Pixel ID</label><input className="input" value={edit.metaPixelId} onChange={(e) => setEdit({ ...edit, metaPixelId: e.target.value })} /></div>
          <div className="field"><label>Meta CAPI Token (rotar)</label><input className="input" value={edit.metaCapiToken} onChange={(e) => setEdit({ ...edit, metaCapiToken: e.target.value })} placeholder="••• sin cambios" /></div>
          <div className="field"><label>Kommo Token (rotar)</label><input className="input" value={edit.kommoToken} onChange={(e) => setEdit({ ...edit, kommoToken: e.target.value })} placeholder="••• sin cambios" /></div>
          <div className="field"><label>Usuario panel</label><input className="input" value={edit.panelUser} onChange={(e) => setEdit({ ...edit, panelUser: e.target.value })} autoComplete="off" placeholder="email o usuario de acceso" /></div>
          <div className="field"><label>Contraseña panel</label><input className="input" type="password" value={edit.panelPassword} onChange={(e) => setEdit({ ...edit, panelPassword: e.target.value })} autoComplete="new-password" placeholder="dejar vacío para no cambiar" /></div>
          <div className="field"><label>Tope por carga (ARS)</label><input className="input" type="number" min="0" step="1000" value={edit.maxOp} onChange={(e) => setEdit({ ...edit, maxOp: e.target.value })} placeholder="50000 (default)" /></div>
        </div>
        <button className="btn" onClick={() => patch({
          name: edit.name,
          eventSuffix: edit.eventSuffix,
          metaPixelId: edit.metaPixelId,
          ...(edit.panelUser.trim() ? { panelUser: edit.panelUser.trim() } : {}),
          ...(edit.metaCapiToken ? { metaCapiToken: edit.metaCapiToken } : {}),
          ...(edit.kommoToken ? { kommoToken: edit.kommoToken } : {}),
          ...(edit.panelPassword ? { panelPassword: edit.panelPassword } : {}),
          ...(t && Number(edit.maxOp) > 0 ? { customFields: { ...t.customFields, max_op_ars: Number(edit.maxOp) } } : {}),
        })}>Guardar cambios</button>
      </div>

      <WebhooksSection slug={slug} />

      <AccountSection slug={slug} settings={settings} reload={load} />

      <LandingsSection slug={slug} landings={landings} bonos={bonos} reload={load} />

      <NumbersSection slug={slug} />

      <SendListSection slug={slug} />
    </>
  );
}

// Datos de cuenta: CBU + Titular (+ mensaje de bienvenida). writeCbu los escribe
// en cada lead. Antes solo se editaban desde el panel del cliente.
function AccountSection({ slug, settings, reload }: { slug: string; settings: { accountName?: string | null; accountCbu?: string | null; message?: string | null } | null; reload: () => void }) {
  const [f, setF] = useState({ accountName: '', accountCbu: '', message: '' });
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    setF({ accountName: settings?.accountName ?? '', accountCbu: settings?.accountCbu ?? '', message: settings?.message ?? '' });
  }, [settings]);

  async function save() {
    setErr(''); setSaved(false);
    try {
      await j('/api/admin/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenant: slug, ...f }) });
      setSaved(true); setTimeout(() => setSaved(false), 2000); reload();
    } catch (e) { setErr((e as Error).message); }
  }

  return (
    <div className="card">
      <div className="card__title">Datos de cuenta <span className="card__sub">CBU y titular que se escriben en cada lead (writeCbu)</span></div>
      <div className="grid-2">
        <div className="field"><label>Titular (para el CBU)</label><input className="input" value={f.accountName} onChange={(e) => setF({ ...f, accountName: e.target.value })} placeholder="Nombre del titular" /></div>
        <div className="field"><label>CBU / Alias</label><input className="input" value={f.accountCbu} onChange={(e) => setF({ ...f, accountCbu: e.target.value })} placeholder="0000..." /></div>
        <div className="field" style={{ gridColumn: '1 / -1' }}><label>Mensaje de bienvenida / bono</label><input className="input" value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} /></div>
      </div>
      {err && <p style={{ color: 'var(--danger)', fontSize: '.85rem' }}>{err}</p>}
      <button className="btn" onClick={save}>{saved ? 'Guardado ✓' : 'Guardar datos de cuenta'}</button>
    </div>
  );
}

// URLs de webhooks del cliente (para pegar en Kommo y en los bots).
function WebhooksSection({ slug }: { slug: string }) {
  const [origin, setOrigin] = useState('');
  const [copied, setCopied] = useState('');
  useEffect(() => { setOrigin(window.location.origin); }, []);
  const hooks = [
    { key: 'kommo', label: 'Kommo — leads / estados / mensajes', hint: 'Kommo → Ajustes → Webhooks', path: `/api/webhooks/kommo/${slug}` },
    { key: 'cargo', label: 'Carga', hint: 'bot CARGO (acción webhook)', path: `/api/conversion-event/${slug}` },
    { key: 'cbu', label: 'CBU', hint: 'bot CBU', path: `/api/cbu/${slug}` },
    { key: 'retiro', label: 'Retiro', hint: 'bot RETIRO', path: `/api/retiro/${slug}` },
  ];
  const copy = (url: string, key: string) => { navigator.clipboard.writeText(url); setCopied(key); setTimeout(() => setCopied(''), 1500); };
  return (
    <div className="card">
      <div className="card__title">Webhooks <span className="card__sub">URLs para pegar en Kommo y en los bots de este cliente</span></div>
      {hooks.map((h) => {
        const url = origin + h.path;
        return (
          <div key={h.key} className="field">
            <label>{h.label} <span style={{ color: 'var(--muted)', fontWeight: 400 }}>· {h.hint}</span></label>
            <div className="row">
              <input className="input" readOnly value={url} onFocus={(e) => e.currentTarget.select()} style={{ flex: 1 }} />
              <button className="btn btn--sm" onClick={() => copy(url, h.key)}>{copied === h.key ? 'Copiado ✓' : 'Copiar'}</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

interface NumberRow { id: string; name: string | null; phone: string | null; type: string | null; status: boolean | null; }
const NUMBER_TYPES = ['publi', 'regular', 'spam', 'remarketing', 'soporte', 'cajero'];

// Números de contacto: la landing rota entre los ACTIVOS de su misma categoría (type).
function NumbersSection({ slug }: { slug: string }) {
  const [rows, setRows] = useState<NumberRow[]>([]);
  const [form, setForm] = useState({ name: '', phone: '', type: 'publi' });
  const [err, setErr] = useState('');

  async function load() {
    try { const d = await j(`/api/admin/numbers?tenant=${slug}`); setRows(d.numbers ?? []); } catch (e) { setErr((e as Error).message); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [slug]);

  async function add() {
    setErr('');
    if (!form.phone.trim()) { setErr('Teléfono requerido'); return; }
    try {
      await j('/api/admin/numbers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenant: slug, ...form }) });
      setForm({ name: '', phone: '', type: form.type }); load();
    } catch (e) { setErr((e as Error).message); }
  }
  async function toggle(n: NumberRow) {
    await j('/api/admin/numbers', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenant: slug, id: n.id, status: !n.status }) });
    load();
  }
  async function del(n: NumberRow) {
    if (!confirm(`¿Eliminar el número ${n.phone}?`)) return;
    await j(`/api/admin/numbers?tenant=${slug}&id=${n.id}`, { method: 'DELETE' });
    load();
  }

  return (
    <div className="card">
      <div className="card__title">
        Números de contacto <span className="card__sub">la landing rota entre los ACTIVOS de su misma categoría</span>
        <span className="nav__spacer" style={{ marginLeft: 'auto' }} />
        <span style={{ fontSize: '.82rem', color: 'var(--muted)' }}>{rows.length}</span>
      </div>

      <table className="table">
        <thead><tr><th>Nombre</th><th>Teléfono</th><th>Categoría</th><th>Activo</th><th></th></tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={5} className="empty">Sin números todavía.</td></tr>}
          {rows.map((n) => (
            <tr key={n.id}>
              <td>{n.name || <span style={{ color: 'var(--muted)' }}>—</span>}</td>
              <td><b>{n.phone}</b></td>
              <td><span className="badge badge--type">{n.type ?? '—'}</span></td>
              <td><label className="toggle"><input type="checkbox" checked={!!n.status} onChange={() => toggle(n)} /><span /></label></td>
              <td className="num"><button className="btn btn--danger-ghost btn--sm" onClick={() => del(n)}>Eliminar</button></td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="grid-2" style={{ marginTop: '1rem' }}>
        <div className="field"><label>Nombre (opcional)</label><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
        <div className="field"><label>Teléfono (con código país)</label><input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="5491155550000" /></div>
        <div className="field"><label>Categoría</label><select className="select" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>{NUMBER_TYPES.map((x) => <option key={x} value={x}>{x}</option>)}</select></div>
      </div>
      {err && <p style={{ color: 'var(--danger)', fontSize: '.85rem' }}>{err}</p>}
      <button className="btn" onClick={add}>+ Agregar número</button>
    </div>
  );
}

interface SendListSummary {
  total: number;
  byTier: { ccpp: string; count: number }[];
  sample: { phone: string; ccpp: string; campaign: string | null }[];
}

function SendListSection({ slug }: { slug: string }) {
  const [sum, setSum] = useState<SendListSummary | null>(null);
  const [text, setText] = useState('');
  const [campaign, setCampaign] = useState('');
  const [ccpp, setCcpp] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  async function load() {
    try { setSum(await j(`/api/admin/send-list?tenant=${slug}`)); } catch (e) { setErr((e as Error).message); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [slug]);

  async function upload() {
    setMsg(''); setErr('');
    try {
      const r = await j('/api/admin/send-list', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenant: slug, text, campaign: campaign || undefined, ccpp: ccpp || undefined }),
      });
      setMsg(`Cargados ${r.upserted}${r.skipped ? ` · ${r.skipped} sin teléfono válido` : ''}`);
      setText('');
      load();
    } catch (e) { setErr((e as Error).message); }
  }
  async function clearAll() {
    if (!confirm('¿Borrar toda la lista de envío de este cliente?')) return;
    await j(`/api/admin/send-list?tenant=${slug}`, { method: 'DELETE' });
    setMsg('Lista vaciada'); load();
  }

  return (
    <div className="card">
      <div className="card__title">
        Lista de envío <span className="card__sub">fallback por teléfono → tier (CRM: /api/v1/resolve?phone=)</span>
        <span className="nav__spacer" style={{ marginLeft: 'auto' }} />
        {sum && <span style={{ fontSize: '.82rem', color: 'var(--muted)' }}>{sum.total} números</span>}
      </div>

      {sum && sum.byTier.length > 0 && (
        <div className="row" style={{ gap: '.5rem', flexWrap: 'wrap', marginBottom: '.8rem' }}>
          {sum.byTier.map((b) => (
            <span key={b.ccpp} className="badge badge--type">{b.ccpp}: {b.count}</span>
          ))}
        </div>
      )}

      <div className="grid-2">
        <div className="field"><label>Campaña (opcional)</label><input className="input" value={campaign} onChange={(e) => setCampaign(e.target.value)} placeholder="reactivacion-julio" /></div>
        <div className="field"><label>CCPP global (si el pegado no lo trae)</label><input className="input" value={ccpp} onChange={(e) => setCcpp(e.target.value)} placeholder="W50" /></div>
      </div>
      <div className="field">
        <label>Pegá la lista: una línea por número, <b>telefono,ccpp</b> (o solo teléfono usando el CCPP global)</label>
        <textarea className="input" style={{ minHeight: 140, fontFamily: 'monospace' }} value={text} onChange={(e) => setText(e.target.value)} placeholder={'+5491128471195,W50\n+5491133334444,E15'} />
      </div>
      {msg && <p style={{ color: 'var(--accent)', fontSize: '.85rem' }}>{msg}</p>}
      {err && <p style={{ color: 'var(--danger)', fontSize: '.85rem' }}>{err}</p>}
      <div className="row" style={{ gap: '.6rem' }}>
        <button className="btn" onClick={upload} disabled={!text.trim()}>Cargar / actualizar</button>
        <button className="btn btn--danger-ghost btn--sm" onClick={clearAll}>Vaciar lista</button>
      </div>
    </div>
  );
}

function LandingsSection({ slug, landings, bonos, reload }: { slug: string; landings: Landing[]; bonos: Record<string, string>; reload: () => void }) {
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const emptyForm = { landingSlug: '', name: '', type: 'publi', brandName: '', primaryColor: '#25d366', waNumber: '', message: '', pixelId: '', ccpp: '', campaign: '', destination: 'whatsapp' };
  const [n, setN] = useState(emptyForm);
  // Generador de link con parámetros.
  const [gen, setGen] = useState({ landingSlug: '', ccpp: '', campaign: '' });
  const [copied, setCopied] = useState(false);
  // Dominio público de las landings (no el del panel).
  const origin = process.env.NEXT_PUBLIC_LANDING_ORIGIN || 'https://go.fichaslibres.online';

  const genLandingSlug = gen.landingSlug || landings[0]?.landingSlug || '';
  const genUrl = (() => {
    if (!genLandingSlug) return '';
    const qs = new URLSearchParams();
    if (gen.ccpp) qs.set('ccpp', gen.ccpp);
    if (gen.campaign) qs.set('campaign', gen.campaign.replace(/[^A-Za-z0-9_-]/g, ''));
    const q = qs.toString();
    return `${origin}/l/${slug}/${genLandingSlug}${q ? `?${q}` : ''}`;
  })();
  const bonoCodes = Object.keys(bonos);

  function startCreate() { setEditId(null); setN(emptyForm); setErr(''); setOpen(true); }
  function startEdit(l: Landing) {
    const c = (l.config ?? {}) as Record<string, string | number | null>;
    const s = (k: string) => (c[k] != null ? String(c[k]) : '');
    setEditId(l.id);
    setErr('');
    setN({
      landingSlug: l.landingSlug ?? '', name: l.name ?? '', type: l.type ?? 'publi',
      brandName: s('brandName'), primaryColor: s('primaryColor') || '#25d366',
      waNumber: s('waNumber'), message: s('message'), pixelId: s('pixelId'),
      ccpp: s('ccpp'), campaign: s('campaign'),
      // Destino: si la landing tiene chatSlug → livechat; si no → whatsapp.
      destination: s('chatSlug') ? 'livechat' : 'whatsapp',
    });
    setOpen(true);
  }
  async function save() {
    setErr('');
    const config = {
      brandName: n.brandName, primaryColor: n.primaryColor, waNumber: n.waNumber,
      message: n.message, pixelId: n.pixelId, ccpp: n.ccpp, campaign: n.campaign,
      // Destino livechat → redirige a /chat/<slug> (chatSlug = slug del cliente).
      // Destino whatsapp → sin chatSlug (rota entre los números activos del tipo).
      chatSlug: n.destination === 'livechat' ? slug : '',
    };
    try {
      if (editId) {
        await j(`/api/admin/landings/${editId}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: n.name || n.landingSlug, type: n.type, config }),
        });
      } else {
        await j('/api/admin/landings', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tenant: slug, landingSlug: n.landingSlug, name: n.name || n.landingSlug, type: n.type, config }),
        });
      }
      setOpen(false); setEditId(null); setN(emptyForm);
      reload();
    } catch (e) { setErr((e as Error).message); }
  }
  async function toggle(l: Landing) {
    await j(`/api/admin/landings/${l.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: !l.active }) });
    reload();
  }
  async function del(l: Landing) {
    if (!confirm(`¿Eliminar la landing "${l.name}"?`)) return;
    await j(`/api/admin/landings/${l.id}`, { method: 'DELETE' });
    reload();
  }

  return (
    <div className="card">
      <div className="card__title">
        Landings <span className="card__sub">servidas en /l/{slug}/&lt;slug&gt;</span>
        <span className="nav__spacer" style={{ marginLeft: 'auto' }} />
        <button className="btn btn--sm" onClick={() => (open ? (setOpen(false), setEditId(null)) : startCreate())}>{open ? 'Cancelar' : '+ Nueva landing'}</button>
      </div>

      {open && (
        <div style={{ marginBottom: '1.2rem', paddingBottom: '1.2rem', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontWeight: 600, marginBottom: '.6rem' }}>{editId ? `Editar landing "${n.landingSlug}"` : 'Nueva landing'}</div>
          <div className="grid-2">
            <div className="field"><label>Slug de la landing</label><input className="input" value={n.landingSlug} disabled={!!editId} onChange={(e) => setN({ ...n, landingSlug: e.target.value })} placeholder="promo-verano" /></div>
            <div className="field"><label>Nombre interno</label><input className="input" value={n.name} onChange={(e) => setN({ ...n, name: e.target.value })} /></div>
            <div className="field"><label>Tipo</label><select className="select" value={n.type} onChange={(e) => setN({ ...n, type: e.target.value })}>{LANDING_TYPES.map((x) => <option key={x} value={x}>{x}</option>)}</select></div>
            <div className="field"><label>Marca (texto)</label><input className="input" value={n.brandName} onChange={(e) => setN({ ...n, brandName: e.target.value })} /></div>
            <div className="field"><label>Color primario</label><input className="input" value={n.primaryColor} onChange={(e) => setN({ ...n, primaryColor: e.target.value })} /></div>
            <div className="field"><label>Destino</label>
              <select className="select" value={n.destination} onChange={(e) => setN({ ...n, destination: e.target.value })}>
                <option value="whatsapp">WhatsApp (rotación de números)</option>
                <option value="livechat">Livechat (chat web)</option>
              </select>
            </div>
            <div className="field"><label>Número de WhatsApp</label>
              {n.destination === 'livechat' ? (
                <div className="input" style={{ display: 'flex', alignItems: 'center', color: 'var(--muted)', fontSize: '.82rem' }}>Redirige al chat web <b style={{ margin: '0 .3rem', color: 'var(--text)' }}>/chat/{slug}</b> (no usa números)</div>
              ) : (
                <div className="input" style={{ display: 'flex', alignItems: 'center', color: 'var(--muted)', fontSize: '.82rem' }}>Rota entre los activos de categoría <b style={{ margin: '0 .3rem', color: 'var(--text)' }}>{n.type}</b> (Números de contacto)</div>
              )}
            </div>
            <div className="field"><label>Pixel ID (override)</label><input className="input" value={n.pixelId} onChange={(e) => setN({ ...n, pixelId: e.target.value })} placeholder="usa el del cliente si vacío" /></div>
            <div className="field"><label>Código bono (CCPP)</label><input className="input" value={n.ccpp} onChange={(e) => setN({ ...n, ccpp: e.target.value })} placeholder="A1" /></div>
            <div className="field"><label>Campaña por defecto</label><input className="input" value={n.campaign} onChange={(e) => setN({ ...n, campaign: e.target.value })} placeholder="CC1" /></div>
            <div className="field" style={{ gridColumn: '1 / -1' }}><label>Mensaje de WhatsApp</label><input className="input" value={n.message} onChange={(e) => setN({ ...n, message: e.target.value })} placeholder="Hola, vi el anuncio y quiero mi beneficio" /></div>
          </div>
          {err && <p style={{ color: 'var(--danger)', fontSize: '.85rem' }}>{err}</p>}
          <button className="btn" onClick={save}>{editId ? 'Guardar cambios' : 'Crear landing'}</button>
        </div>
      )}

      <table className="table">
        <thead><tr><th>Slug</th><th>Tipo</th><th>URL pública</th><th>Activa</th><th></th></tr></thead>
        <tbody>
          {landings.length === 0 && <tr><td colSpan={5} className="empty">Sin landings todavía.</td></tr>}
          {landings.map((l) => (
            <tr key={l.id}>
              <td><b>{l.landingSlug}</b><div style={{ color: 'var(--muted)', fontSize: '.78rem' }}>{l.name}</div></td>
              <td><span className="badge badge--type">{l.type}</span></td>
              <td><a href={`/l/${slug}/${l.landingSlug}`} target="_blank" style={{ color: 'var(--blue)' }}>{origin}/l/{slug}/{l.landingSlug}</a></td>
              <td><label className="toggle"><input type="checkbox" checked={!!l.active} onChange={() => toggle(l)} /><span /></label></td>
              <td className="num">
                <button className="btn btn--ghost btn--sm" onClick={() => startEdit(l)}>Editar</button>
                <button className="btn btn--danger-ghost btn--sm" style={{ marginLeft: '.4rem' }} onClick={() => del(l)}>Eliminar</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {landings.length > 0 && (
        <div style={{ marginTop: '1.3rem', paddingTop: '1.1rem', borderTop: '1px solid var(--border)' }}>
          <div style={{ fontWeight: 600, marginBottom: '.7rem' }}>🔗 Generar link con parámetros</div>
          <div className="grid-2">
            <div className="field"><label>Landing</label>
              <select className="select" value={genLandingSlug} onChange={(e) => setGen({ ...gen, landingSlug: e.target.value })}>
                {landings.map((l) => <option key={l.id} value={l.landingSlug ?? ''}>{l.name} ({l.landingSlug})</option>)}
              </select>
            </div>
            <div className="field"><label>CCPP (bono)</label>
              <select className="select" value={gen.ccpp} onChange={(e) => setGen({ ...gen, ccpp: e.target.value })}>
                <option value="">— sin ccpp —</option>
                {bonoCodes.map((code) => <option key={code} value={code}>{code} — {bonos[code]}</option>)}
              </select>
            </div>
            <div className="field" style={{ gridColumn: '1 / -1' }}><label>Campaign (nombre libre)</label><input className="input" value={gen.campaign} onChange={(e) => setGen({ ...gen, campaign: e.target.value })} placeholder="CC1" /></div>
          </div>
          <div className="field">
            <label>URL generada</label>
            <div className="row">
              <input className="input" readOnly value={genUrl} onFocus={(e) => e.currentTarget.select()} style={{ flex: 1 }} />
              <button className="btn" onClick={() => { navigator.clipboard.writeText(genUrl); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>{copied ? 'Copiado ✓' : 'Copiar'}</button>
              <a className="btn btn--ghost" href={genUrl} target="_blank">Abrir</a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

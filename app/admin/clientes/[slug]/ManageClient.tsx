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
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  // Campos editables del tenant
  const [edit, setEdit] = useState({ name: '', eventSuffix: '', metaPixelId: '', metaCapiToken: '', kommoToken: '', panelPassword: '' });

  async function load() {
    try {
      const d = await j(`/api/admin/tenant/${slug}`);
      setT(d.tenant);
      setLandings(d.landings ?? []);
      setEdit((p) => ({ ...p, name: d.tenant.name ?? '', eventSuffix: d.tenant.eventSuffix ?? '', metaPixelId: d.tenant.metaPixelId ?? '' }));
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
        <div className="card__title">Datos y credenciales <span className="card__sub">dejá un secreto vacío para no cambiarlo</span></div>
        <div className="grid-2">
          <div className="field"><label>Nombre</label><input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></div>
          <div className="field"><label>Event suffix</label><input className="input" value={edit.eventSuffix} onChange={(e) => setEdit({ ...edit, eventSuffix: e.target.value })} /></div>
          <div className="field"><label>Meta Pixel ID</label><input className="input" value={edit.metaPixelId} onChange={(e) => setEdit({ ...edit, metaPixelId: e.target.value })} /></div>
          <div className="field"><label>Meta CAPI Token (rotar)</label><input className="input" value={edit.metaCapiToken} onChange={(e) => setEdit({ ...edit, metaCapiToken: e.target.value })} placeholder="••• sin cambios" /></div>
          <div className="field"><label>Kommo Token (rotar)</label><input className="input" value={edit.kommoToken} onChange={(e) => setEdit({ ...edit, kommoToken: e.target.value })} placeholder="••• sin cambios" /></div>
          <div className="field"><label>Reset contraseña panel</label><input className="input" value={edit.panelPassword} onChange={(e) => setEdit({ ...edit, panelPassword: e.target.value })} placeholder="••• sin cambios" /></div>
        </div>
        <button className="btn" onClick={() => patch({
          name: edit.name,
          eventSuffix: edit.eventSuffix,
          metaPixelId: edit.metaPixelId,
          ...(edit.metaCapiToken ? { metaCapiToken: edit.metaCapiToken } : {}),
          ...(edit.kommoToken ? { kommoToken: edit.kommoToken } : {}),
          ...(edit.panelPassword ? { panelPassword: edit.panelPassword } : {}),
        })}>Guardar cambios</button>
      </div>

      <LandingsSection slug={slug} landings={landings} reload={load} />
    </>
  );
}

function LandingsSection({ slug, landings, reload }: { slug: string; landings: Landing[]; reload: () => void }) {
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState('');
  const [n, setN] = useState({ landingSlug: '', name: '', type: 'publi', brandName: '', primaryColor: '#25d366', waNumber: '', message: '', pixelId: '', ccpp: '', campaign: '' });
  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  async function create() {
    setErr('');
    try {
      await j('/api/admin/landings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenant: slug, landingSlug: n.landingSlug, name: n.name || n.landingSlug, type: n.type,
          config: { brandName: n.brandName, primaryColor: n.primaryColor, waNumber: n.waNumber, message: n.message, pixelId: n.pixelId, ccpp: n.ccpp, campaign: n.campaign },
        }),
      });
      setOpen(false);
      setN({ landingSlug: '', name: '', type: 'publi', brandName: '', primaryColor: '#25d366', waNumber: '', message: '', pixelId: '', ccpp: '', campaign: '' });
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
        <button className="btn btn--sm" onClick={() => setOpen((v) => !v)}>{open ? 'Cancelar' : '+ Nueva landing'}</button>
      </div>

      {open && (
        <div style={{ marginBottom: '1.2rem', paddingBottom: '1.2rem', borderBottom: '1px solid var(--border)' }}>
          <div className="grid-2">
            <div className="field"><label>Slug de la landing</label><input className="input" value={n.landingSlug} onChange={(e) => setN({ ...n, landingSlug: e.target.value })} placeholder="promo-verano" /></div>
            <div className="field"><label>Nombre interno</label><input className="input" value={n.name} onChange={(e) => setN({ ...n, name: e.target.value })} /></div>
            <div className="field"><label>Tipo</label><select className="select" value={n.type} onChange={(e) => setN({ ...n, type: e.target.value })}>{LANDING_TYPES.map((x) => <option key={x} value={x}>{x}</option>)}</select></div>
            <div className="field"><label>Marca (texto)</label><input className="input" value={n.brandName} onChange={(e) => setN({ ...n, brandName: e.target.value })} /></div>
            <div className="field"><label>Color primario</label><input className="input" value={n.primaryColor} onChange={(e) => setN({ ...n, primaryColor: e.target.value })} /></div>
            <div className="field"><label>WhatsApp (con código país)</label><input className="input" value={n.waNumber} onChange={(e) => setN({ ...n, waNumber: e.target.value })} placeholder="5491155550000" /></div>
            <div className="field"><label>Pixel ID (override)</label><input className="input" value={n.pixelId} onChange={(e) => setN({ ...n, pixelId: e.target.value })} placeholder="usa el del cliente si vacío" /></div>
            <div className="field"><label>Código bono (CCPP)</label><input className="input" value={n.ccpp} onChange={(e) => setN({ ...n, ccpp: e.target.value })} placeholder="A1" /></div>
            <div className="field"><label>Campaña por defecto</label><input className="input" value={n.campaign} onChange={(e) => setN({ ...n, campaign: e.target.value })} placeholder="CC1" /></div>
            <div className="field" style={{ gridColumn: '1 / -1' }}><label>Mensaje de WhatsApp</label><input className="input" value={n.message} onChange={(e) => setN({ ...n, message: e.target.value })} placeholder="Hola, vi el anuncio y quiero mi beneficio" /></div>
          </div>
          {err && <p style={{ color: 'var(--danger)', fontSize: '.85rem' }}>{err}</p>}
          <button className="btn" onClick={create}>Crear landing</button>
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
              <td className="num"><button className="btn btn--danger-ghost btn--sm" onClick={() => del(l)}>Eliminar</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

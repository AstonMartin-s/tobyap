'use client';

import { useState } from 'react';

async function j(url: string, opts?: RequestInit) {
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

const slugify = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]/g, '');

export function DeployClient() {
  const [f, setF] = useState({
    name: '',
    slug: '',
    panelUser: '',
    panelPassword: '',
    eventSuffix: '',
    readonly: false,
    kommoSubdomain: '',
    kommoToken: '',
    kommoEmail: '',
    kommoPassword: '',
    pipelineName: '',
    metaPixelId: '',
    metaCapiToken: '',
    mode: 'provision' as 'provision' | 'discover',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [result, setResult] = useState<null | {
    webhook: string;
    pipelineId: number;
    customFields: Record<string, number>;
  }>(null);

  const set = (k: keyof typeof f) => (v: string | boolean) => setF((p) => ({ ...p, [k]: v }));

  async function deploy() {
    setBusy(true);
    setErr('');
    setResult(null);
    try {
      const data = await j('/api/admin/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...f, slug: f.slug || slugify(f.kommoSubdomain) }),
      });
      setResult(data);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  return (
    <>
      <div className="page-head">
        <div className="page-head__text">
          <h1>Deploy de cliente</h1>
          <p>Cargá las credenciales y el sistema crea el cliente + provisiona el funnel en Kommo.</p>
        </div>
      </div>

      {result ? (
        <div className="card">
          <div className="card__title"><span className="ico">✓</span> Cliente desplegado</div>
          <p style={{ color: 'var(--muted)', marginTop: 0 }}>
            Pegá esta URL como webhook en Kommo (Ajustes → Webhooks), eventos <b>Lead agregado</b>, <b>Etapa del lead cambia</b> y <b>Mensaje entrante</b>:
          </p>
          <div className="field">
            <input className="input" readOnly value={`${origin}${result.webhook}`} onFocus={(e) => e.currentTarget.select()} />
          </div>
          <p style={{ color: 'var(--muted)', fontSize: '.85rem' }}>
            Pipeline: <b>{result.pipelineId}</b> · Campos mapeados: {Object.keys(result.customFields).length}
          </p>
          <div className="row">
            <a className="btn" href="/admin/clientes">Ver clientes</a>
            <button className="btn btn--ghost" onClick={() => setResult(null)}>Cargar otro</button>
          </div>
        </div>
      ) : (
        <>
          <div className="card">
            <div className="card__title">1 · Identidad</div>
            <div className="grid-2">
              <div className="field">
                <label>Nombre del cliente</label>
                <input className="input" value={f.name} onChange={(e) => set('name')(e.target.value)} placeholder="Casino Ejemplo" />
              </div>
              <div className="field">
                <label>Slug (URL del webhook/landing)</label>
                <input className="input" value={f.slug} onChange={(e) => set('slug')(slugify(e.target.value))} placeholder="auto desde subdominio" />
              </div>
              <div className="field">
                <label>Usuario del panel (email del CRM)</label>
                <input className="input" value={f.panelUser} onChange={(e) => set('panelUser')(e.target.value)} />
              </div>
              <div className="field">
                <label>Contraseña del panel</label>
                <input className="input" value={f.panelPassword} onChange={(e) => set('panelPassword')(e.target.value)} />
              </div>
              <div className="field">
                <label>Event suffix (Meta)</label>
                <input className="input" value={f.eventSuffix} onChange={(e) => set('eventSuffix')(e.target.value)} placeholder="21" />
              </div>
              <div className="field" style={{ display: 'flex', alignItems: 'center', gap: '.6rem', marginTop: '1.6rem' }}>
                <label className="toggle">
                  <input type="checkbox" checked={f.readonly} onChange={(e) => set('readonly')(e.target.checked)} />
                  <span />
                </label>
                <span style={{ fontSize: '.85rem', color: 'var(--muted)' }}>Solo lectura (no escribe en el CRM)</span>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card__title">2 · Kommo</div>
            <div className="grid-2">
              <div className="field">
                <label>Subdominio Kommo</label>
                <input className="input" value={f.kommoSubdomain} onChange={(e) => set('kommoSubdomain')(e.target.value)} placeholder="micliente" />
              </div>
              <div className="field">
                <label>Pipeline (nombre, opcional)</label>
                <input className="input" value={f.pipelineName} onChange={(e) => set('pipelineName')(e.target.value)} placeholder="Embudo de ventas" />
              </div>
              <div className="field" style={{ gridColumn: '1 / -1' }}>
                <label>Token de integración (long-lived)</label>
                <input className="input" value={f.kommoToken} onChange={(e) => set('kommoToken')(e.target.value)} placeholder="eyJ0eXAiOiJKV1Qi..." />
              </div>
              <div className="field">
                <label>Email del CRM</label>
                <input className="input" value={f.kommoEmail} onChange={(e) => set('kommoEmail')(e.target.value)} />
              </div>
              <div className="field">
                <label>Contraseña del CRM</label>
                <input className="input" value={f.kommoPassword} onChange={(e) => set('kommoPassword')(e.target.value)} />
              </div>
            </div>
            <div className="field" style={{ marginTop: '.4rem' }}>
              <label>Funnel</label>
              <select className="select" value={f.mode} onChange={(e) => set('mode')(e.target.value)}>
                <option value="provision">Provisionar funnel estándar (crea pipelines/campos/estados)</option>
                <option value="discover">Usar funnel existente (mapear por nombre)</option>
              </select>
            </div>
          </div>

          <div className="card">
            <div className="card__title">3 · Meta</div>
            <div className="grid-2">
              <div className="field">
                <label>Pixel ID</label>
                <input className="input" value={f.metaPixelId} onChange={(e) => set('metaPixelId')(e.target.value)} placeholder="1131496748897137" />
              </div>
              <div className="field">
                <label>CAPI Access Token</label>
                <input className="input" value={f.metaCapiToken} onChange={(e) => set('metaCapiToken')(e.target.value)} placeholder="EAAxxxxxx..." />
              </div>
            </div>
          </div>

          {err && <p style={{ color: 'var(--danger)', fontSize: '.88rem' }}>{err}</p>}
          <button className="btn" disabled={busy} onClick={deploy} style={{ padding: '.75rem 1.4rem' }}>
            {busy ? <span className="spinner" /> : '🚀'} {busy ? 'Desplegando…' : 'Deploy cliente'}
          </button>
        </>
      )}
    </>
  );
}

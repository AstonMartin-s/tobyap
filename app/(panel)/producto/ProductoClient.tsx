'use client';

import { useEffect, useState } from 'react';
import type {
  TiendaConfig,
  TiendaProduct,
  TiendaPaymentMethod,
  PaymentMethodType,
  DeliveryMode,
} from '@/lib/chat/tienda';

const PAYMENT_LABELS: Record<PaymentMethodType, string> = {
  transfer: 'Transferencia (CBU / alias)',
  payment_link: 'Link de pago (Mercado Pago, etc.)',
  other: 'Otro',
};

const DELIVERY_LABELS: Record<DeliveryMode, string> = {
  link: 'Link de descarga / acceso (se manda en el chat al confirmar)',
  email: 'Por email',
  manual: 'Manual (el operario lo envía; solo disparamos la conversión)',
};

const EMPTY: TiendaConfig = {
  brandName: '',
  currency: 'ARS',
  products: [],
  payments: [{ type: 'transfer', enabled: true, label: 'Transferencia' }],
  delivery: { mode: 'link' },
  supportUrl: '',
};

function uid() {
  return `p${Math.random().toString(36).slice(2, 8)}`;
}

export function ProductoClient() {
  const [cfg, setCfg] = useState<TiendaConfig>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    fetch('/api/panel/tienda')
      .then((r) => r.json())
      .then((d) => { if (d?.tienda) setCfg(d.tienda); })
      .catch(() => setMsg('No se pudo leer la config'))
      .finally(() => setLoading(false));
  }, []);

  function patch(p: Partial<TiendaConfig>) {
    setCfg((c) => ({ ...c, ...p }));
  }

  // ── Productos ────────────────────────────────────────────────────────────
  function addProduct() {
    const p: TiendaProduct = { id: uid(), name: '', price: 0, currency: cfg.currency, active: true };
    patch({ products: [...cfg.products, p] });
  }
  function updProduct(id: string, u: Partial<TiendaProduct>) {
    patch({ products: cfg.products.map((p) => (p.id === id ? { ...p, ...u } : p)) });
  }
  function delProduct(id: string) {
    patch({ products: cfg.products.filter((p) => p.id !== id) });
  }

  // ── Pagos ────────────────────────────────────────────────────────────────
  function togglePayment(type: PaymentMethodType) {
    const has = cfg.payments.find((p) => p.type === type);
    if (has) {
      patch({ payments: cfg.payments.map((p) => (p.type === type ? { ...p, enabled: !p.enabled } : p)) });
    } else {
      patch({ payments: [...cfg.payments, { type, enabled: true, label: PAYMENT_LABELS[type] }] });
    }
  }
  function updPayment(type: PaymentMethodType, u: Partial<TiendaPaymentMethod>) {
    patch({ payments: cfg.payments.map((p) => (p.type === type ? { ...p, ...u } : p)) });
  }
  const paymentOf = (type: PaymentMethodType) => cfg.payments.find((p) => p.type === type);

  async function save() {
    setSaving(true);
    setMsg('');
    try {
      const r = await fetch('/api/panel/tienda', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cfg),
      });
      const d = await r.json();
      if (r.ok && d?.tienda) { setCfg(d.tienda); setMsg('✓ Guardado'); }
      else setMsg(d?.error || 'No se pudo guardar');
    } catch {
      setMsg('Error de red al guardar');
    } finally {
      setSaving(false);
      setTimeout(() => setMsg(''), 3000);
    }
  }

  if (loading) return <p style={{ color: 'var(--muted)' }}>Cargando…</p>;

  const card: React.CSSProperties = {
    background: 'var(--card-2)', border: '1px solid var(--border)', borderRadius: 12,
    padding: '1rem 1.1rem', marginBottom: '1rem',
  };
  const h2: React.CSSProperties = { fontSize: '1rem', margin: '0 0 .2rem' };
  const hint: React.CSSProperties = { color: 'var(--muted)', fontSize: '.78rem', margin: '0 0 .8rem' };

  return (
    <div style={{ maxWidth: 820 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '.4rem' }}>
        <div>
          <h1 style={{ margin: 0 }}>Producto</h1>
          <p style={{ color: 'var(--muted)', margin: '.2rem 0 0' }}>
            Definí tu proceso de venta: qué vendés, cómo cobrás y cómo entregás. El chat se arma con esto.
          </p>
        </div>
        <button className="btn" onClick={save} disabled={saving}>
          {saving ? 'Guardando…' : 'Guardar'}
        </button>
      </div>
      {msg && <p style={{ color: msg.startsWith('✓') ? '#4caf50' : '#e57373', fontSize: '.85rem' }}>{msg}</p>}

      {/* Marca */}
      <section style={card}>
        <h2 style={h2}>Marca</h2>
        <p style={hint}>Nombre y moneda de tu tienda.</p>
        <div className="row" style={{ display: 'flex', gap: '.8rem', flexWrap: 'wrap' }}>
          <div className="field" style={{ flex: '1 1 260px' }}>
            <label>Nombre de la tienda</label>
            <input className="input" value={cfg.brandName} onChange={(e) => patch({ brandName: e.target.value })} placeholder="Casa Urbana" />
          </div>
          <div className="field" style={{ width: 120 }}>
            <label>Moneda</label>
            <input className="input" value={cfg.currency} onChange={(e) => patch({ currency: e.target.value.toUpperCase().slice(0, 3) })} placeholder="ARS" />
          </div>
        </div>
        <div className="field" style={{ marginTop: '.5rem' }}>
          <label>Link de soporte (WhatsApp u otro) <span style={{ color: 'var(--muted)', fontSize: '.72rem' }}>opcional</span></label>
          <input className="input" value={cfg.supportUrl} onChange={(e) => patch({ supportUrl: e.target.value })} placeholder="https://wa.me/549..." />
        </div>
      </section>

      {/* Productos */}
      <section style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={h2}>Productos</h2>
            <p style={hint}>Los ebooks / productos que ofrecés. Cada uno es un botón en el chat.</p>
          </div>
          <button className="btn btn--soft" type="button" onClick={addProduct}>+ Producto</button>
        </div>
        {cfg.products.length === 0 && (
          <div style={{ padding: '.7rem .8rem', borderRadius: 8, background: 'var(--blue-soft)', border: '1px solid var(--border)', fontSize: '.8rem', color: 'var(--muted)' }}>
            Todavía no cargaste ningún producto. Tocá <b>+ Producto</b> para empezar.
          </div>
        )}
        {cfg.products.map((p) => (
          <div key={p.id} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '.8rem', marginTop: '.7rem' }}>
            <div style={{ display: 'flex', gap: '.8rem', flexWrap: 'wrap' }}>
              <div className="field" style={{ flex: '2 1 240px' }}>
                <label>Nombre</label>
                <input className="input" value={p.name} onChange={(e) => updProduct(p.id, { name: e.target.value })} placeholder="Ebook: Reformá tu casa" />
              </div>
              <div className="field" style={{ width: 130 }}>
                <label>Precio ({p.currency || cfg.currency})</label>
                <input className="input" type="number" min={0} value={p.price} onChange={(e) => updProduct(p.id, { price: Number(e.target.value) })} />
              </div>
            </div>
            <div className="field" style={{ marginTop: '.5rem' }}>
              <label>Descripción <span style={{ color: 'var(--muted)', fontSize: '.72rem' }}>opcional</span></label>
              <input className="input" value={p.description ?? ''} onChange={(e) => updProduct(p.id, { description: e.target.value })} placeholder="Qué incluye, formato, páginas…" />
            </div>
            <div className="field" style={{ marginTop: '.5rem' }}>
              <label>Link de entrega (descarga / acceso) <span style={{ color: 'var(--muted)', fontSize: '.72rem' }}>se manda al liberar</span></label>
              <input className="input" value={p.deliveryUrl ?? ''} onChange={(e) => updProduct(p.id, { deliveryUrl: e.target.value })} placeholder="https://drive.google.com/..." />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '.6rem' }}>
              <label style={{ display: 'flex', gap: '.4rem', alignItems: 'center', fontSize: '.85rem' }}>
                <input type="checkbox" checked={p.active} onChange={(e) => updProduct(p.id, { active: e.target.checked })} />
                Activo (visible en el chat)
              </label>
              <button className="btn btn--ghost" type="button" onClick={() => delProduct(p.id)} style={{ color: 'var(--danger, #e57373)' }}>Eliminar</button>
            </div>
          </div>
        ))}
      </section>

      {/* Pago */}
      <section style={card}>
        <h2 style={h2}>Pago</h2>
        <p style={hint}>Marcá los métodos que aceptás y completá los datos.</p>
        {(Object.keys(PAYMENT_LABELS) as PaymentMethodType[]).map((type) => {
          const pm = paymentOf(type);
          const enabled = !!pm?.enabled;
          return (
            <div key={type} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '.7rem .8rem', marginTop: '.6rem' }}>
              <label style={{ display: 'flex', gap: '.5rem', alignItems: 'center', fontSize: '.9rem' }}>
                <input type="checkbox" checked={enabled} onChange={() => togglePayment(type)} />
                <b>{PAYMENT_LABELS[type]}</b>
              </label>
              {enabled && (
                <div className="field" style={{ marginTop: '.5rem' }}>
                  <label>{type === 'transfer' ? 'CBU / Alias' : type === 'payment_link' ? 'URL del checkout' : 'Datos / instrucciones'}</label>
                  <input className="input" value={pm?.data ?? ''} onChange={(e) => updPayment(type, { data: e.target.value })}
                    placeholder={type === 'transfer' ? '0000... o alias.mp' : type === 'payment_link' ? 'https://mpago.la/...' : 'Cómo pagar'} />
                </div>
              )}
            </div>
          );
        })}
      </section>

      {/* Entrega */}
      <section style={card}>
        <h2 style={h2}>Entrega</h2>
        <p style={hint}>Cómo recibe el cliente el ebook cuando confirmás la compra ("liberar producto").</p>
        <div className="field">
          <label>Modo de entrega</label>
          <select className="input" value={cfg.delivery.mode} onChange={(e) => patch({ delivery: { ...cfg.delivery, mode: e.target.value as DeliveryMode } })}>
            {(Object.keys(DELIVERY_LABELS) as DeliveryMode[]).map((m) => (
              <option key={m} value={m}>{DELIVERY_LABELS[m]}</option>
            ))}
          </select>
        </div>
        <div className="field" style={{ marginTop: '.5rem' }}>
          <label>Nota de entrega <span style={{ color: 'var(--muted)', fontSize: '.72rem' }}>opcional</span></label>
          <input className="input" value={cfg.delivery.note ?? ''} onChange={(e) => patch({ delivery: { ...cfg.delivery, note: e.target.value } })} placeholder="Ej: revisá spam; acceso de por vida" />
        </div>
      </section>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button className="btn" onClick={save} disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</button>
      </div>
    </div>
  );
}

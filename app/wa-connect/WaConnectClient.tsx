'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type WaState = { enabled: boolean; status: string; lastError: string | null; qr: string | null };

const LABELS: Record<string, { txt: string; color: string }> = {
  connected: { txt: 'Conectado', color: '#22c55e' },
  connecting: { txt: 'Conectando…', color: '#f59e0b' },
  reconnecting: { txt: 'Reconectando…', color: '#f59e0b' },
  waiting_reconnect: { txt: 'Esperando reconexión…', color: '#f59e0b' },
  qr: { txt: 'Escaneá el QR', color: '#f59e0b' },
  disconnected: { txt: 'Desconectado', color: '#ef4444' },
  error: { txt: 'Error', color: '#ef4444' },
  unknown: { txt: 'Sin datos', color: '#8b93a9' },
};

export function WaConnectClient() {
  const [state, setState] = useState<WaState | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const aliveRef = useRef(true);

  const pull = useCallback(async (fresh = false) => {
    try {
      const d = await fetch(`/api/panel/wa-status${fresh ? '?fresh=1' : ''}`).then((r) => r.json());
      if (!aliveRef.current) return;
      setLoaded(true);
      if (d?.enabled) {
        setState({ enabled: true, status: String(d.status ?? 'unknown'), lastError: d.lastError ?? null, qr: typeof d.qr === 'string' ? d.qr : null });
      } else {
        setState({ enabled: false, status: 'unknown', lastError: null, qr: null });
      }
    } catch { /* ignora */ }
  }, []);

  // Refresco rápido mientras no está conectado (el QR rota ~20s). Cuando conecta,
  // bajamos la frecuencia.
  useEffect(() => {
    aliveRef.current = true;
    pull(true);
    return () => { aliveRef.current = false; };
  }, [pull]);

  useEffect(() => {
    const connected = state?.status === 'connected';
    const ms = connected ? 15000 : 3500;
    const t = setInterval(() => pull(true), ms);
    return () => clearInterval(t);
  }, [state?.status, pull]);

  const connect = async () => {
    setBusy(true);
    try {
      await fetch('/api/panel/wa-reconnect', { method: 'POST' });
      // Dale un momento al gateway para emitir el QR y refrescá seguido.
      setTimeout(() => pull(true), 1500);
      setTimeout(() => pull(true), 4000);
    } finally {
      setBusy(false);
    }
  };

  const meta = LABELS[state?.status ?? 'unknown'] ?? LABELS.unknown;
  const connected = state?.status === 'connected';
  const qrSrc = state?.qr
    ? (state.qr.startsWith('data:') ? state.qr : `data:image/png;base64,${state.qr}`)
    : null;

  if (loaded && state && !state.enabled) {
    return (
      <div className="card" style={{ maxWidth: 520, margin: '2rem auto', padding: '1.6rem', textAlign: 'center' }}>
        <h2 style={{ marginTop: 0 }}>WhatsApp Connect</h2>
        <p style={{ color: 'var(--muted)' }}>Este cliente todavía no tiene el canal de WhatsApp configurado.</p>
      </div>
    );
  }

  return (
    <div className="card" style={{ maxWidth: 520, margin: '2rem auto', padding: '1.6rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', marginBottom: '1rem' }}>
        <h2 style={{ margin: 0, flex: 1 }}>WhatsApp Connect</h2>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '.4rem', fontSize: '.82rem', fontWeight: 600, color: meta.color }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: meta.color, boxShadow: `0 0 8px ${meta.color}` }} />
          {meta.txt}
        </span>
      </div>

      {connected ? (
        <div style={{ textAlign: 'center', padding: '1.5rem 0' }}>
          <div style={{ fontSize: '2.4rem', lineHeight: 1 }}>✅</div>
          <p style={{ fontWeight: 600, marginBottom: '.3rem' }}>El número está vinculado.</p>
          <p style={{ color: 'var(--muted)', fontSize: '.85rem' }}>Los mensajes entrantes aparecen en Chats web, pestaña WhatsApp.</p>
          <button type="button" disabled={busy} onClick={connect} style={{ marginTop: '1rem', padding: '.4rem .9rem', fontSize: '.8rem', fontWeight: 600, borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--muted)', cursor: 'pointer' }}>
            Revincular (nuevo QR)
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '.9rem' }}>
          <div style={{ width: 256, height: 256, display: 'flex', alignItems: 'center', justifyContent: 'center', background: qrSrc ? '#fff' : 'var(--bg-2, rgba(255,255,255,.03))', borderRadius: 14, border: '1px solid var(--border)' }}>
            {qrSrc
              ? <img alt="QR de WhatsApp" src={qrSrc} style={{ width: 236, height: 236 }} />
              : <span style={{ color: 'var(--muted)', fontSize: '.82rem', textAlign: 'center', padding: '0 1rem' }}>{busy ? 'Generando el QR…' : 'Tocá Conectar para generar el código'}</span>}
          </div>
          <ol style={{ color: 'var(--muted)', fontSize: '.82rem', lineHeight: 1.5, margin: 0, paddingLeft: '1.1rem', alignSelf: 'stretch' }}>
            <li>Abrí WhatsApp en el teléfono del inbox.</li>
            <li>Ajustes → Dispositivos vinculados → Vincular un dispositivo.</li>
            <li>Escaneá este código. Si da error, generá uno nuevo: caduca a los segundos.</li>
          </ol>
          <button type="button" disabled={busy} onClick={connect} style={{ padding: '.5rem 1.1rem', fontSize: '.85rem', fontWeight: 700, borderRadius: 9, border: 'none', background: '#25D366', color: '#fff', cursor: 'pointer' }}>
            {busy ? '…' : qrSrc ? 'Generar nuevo QR' : 'Conectar'}
          </button>
          {state?.lastError && <span style={{ fontSize: '.72rem', color: 'var(--muted)', textAlign: 'center' }}>{state.lastError}</span>}
        </div>
      )}
    </div>
  );
}

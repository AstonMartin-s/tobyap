'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type WaState = {
  enabled: boolean;
  status: string;
  lastError: string | null;
  qr: string | null;
  phone: string | null;
  device: string | null;
  connectionStatus: string | null;
  authenticationStatus: string | null;
  lastCausalEvent: string | null;
  sessionHealth: string | null;
};

function phoneFromJid(jid: unknown): string | null {
  if (typeof jid !== 'string' || !jid) return null;
  const digits = jid.split('@')[0].split(':')[0].replace(/\D/g, '');
  return digits ? `+${digits}` : null;
}

const STATUS_LABEL: Record<string, { txt: string; color: string }> = {
  connected: { txt: 'Conectado', color: '#22c55e' },
  connecting: { txt: 'Conectando…', color: '#f59e0b' },
  reconnecting: { txt: 'Reconectando…', color: '#f59e0b' },
  waiting_reconnect: { txt: 'Esperando reconexión…', color: '#f59e0b' },
  qr: { txt: 'Escaneá el QR', color: '#f59e0b' },
  disconnected: { txt: 'Desconectado', color: '#ef4444' },
  error: { txt: 'Error', color: '#ef4444' },
  unknown: { txt: 'Sin datos', color: '#8b93a9' },
};

const AUTH_LABEL: Record<string, string> = {
  authenticated: 'Vinculado',
  pairing: 'Emparejando',
  unknown: 'Sin dato',
  revoked: 'Revocado',
};

const SOCK_LABEL: Record<string, string> = {
  connected: 'En línea',
  reconnecting: 'Reconectando',
  pairing: 'Emparejando',
  disconnected_temporary: 'Caída corta',
  disconnected: 'Cortado',
};

// Única señal fehaciente de cuidar el número: authenticationStatus=revoked.
// La disparan LoggedOut, StreamReplaced, TemporaryBan, ClientOutdated y PairError.
// Disconnected / KeepAliveTimeout / ConnectFailure / StreamError NO son aviso.
function careNote(state: WaState | null): string | null {
  if (!state || state.authenticationStatus !== 'revoked') return null;
  const cause = state.lastCausalEvent?.trim();
  return cause
    ? `El vínculo de este número quedó revocado (${cause}).`
    : 'El vínculo de este número quedó revocado.';
}

const WaLogo = ({ size = 28 }: { size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="#25D366" aria-hidden>
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
  </svg>
);

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
        setState({
          enabled: true,
          status: String(d.status ?? 'unknown'),
          lastError: d.lastError ?? null,
          qr: typeof d.qr === 'string' ? d.qr : null,
          phone: phoneFromJid(d.jid),
          device: typeof d.device === 'string' ? d.device : null,
          connectionStatus: typeof d.connectionStatus === 'string' ? d.connectionStatus : null,
          authenticationStatus: typeof d.authenticationStatus === 'string' ? d.authenticationStatus : null,
          lastCausalEvent: typeof d.lastCausalEvent === 'string' ? d.lastCausalEvent : null,
          sessionHealth: typeof d.sessionHealth === 'string' ? d.sessionHealth : null,
        });
      } else {
        setState({
          enabled: false, status: 'unknown', lastError: null, qr: null, phone: null,
          device: null, connectionStatus: null, authenticationStatus: null, lastCausalEvent: null, sessionHealth: null,
        });
      }
    } catch { /* ignora */ }
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    pull(true);
    return () => { aliveRef.current = false; };
  }, [pull]);

  useEffect(() => {
    const connected = state?.status === 'connected';
    const ms = connected ? 30000 : 3500;
    const t = setInterval(() => pull(true), ms);
    return () => clearInterval(t);
  }, [state?.status, pull]);

  const connect = async () => {
    setBusy(true);
    try {
      await fetch('/api/panel/wa-reconnect', { method: 'POST' });
      setTimeout(() => pull(true), 1500);
      setTimeout(() => pull(true), 4000);
    } finally {
      setBusy(false);
    }
  };

  const meta = STATUS_LABEL[state?.status ?? 'unknown'] ?? STATUS_LABEL.unknown;
  const connected = state?.status === 'connected';
  const care = careNote(state);
  const qrSrc = state?.qr
    ? (state.qr.startsWith('data:') ? state.qr : `data:image/png;base64,${state.qr}`)
    : null;

  if (loaded && state && !state.enabled) {
    return (
      <div className="card" style={{ maxWidth: 720, margin: '1.4rem auto', padding: '1.6rem', textAlign: 'center' }}>
        <WaLogo size={36} />
        <h2 style={{ margin: '.6rem 0 0' }}>WhatsApp</h2>
        <p style={{ color: 'var(--muted)' }}>Este cliente todavía no tiene el canal de WhatsApp configurado.</p>
      </div>
    );
  }

  const cell = { padding: '.55rem .7rem', borderBottom: '1px solid var(--border)', fontSize: '.8rem', textAlign: 'left' as const };
  const th = { ...cell, color: 'var(--muted)', fontWeight: 700, fontSize: '.68rem', letterSpacing: '.04em', textTransform: 'uppercase' as const };

  return (
    <div style={{ maxWidth: 880, margin: '1.2rem auto', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div className="card" style={{ padding: '1.15rem 1.3rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '.7rem' }}>
          <WaLogo size={32} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: '1.15rem' }}>WhatsApp</h2>
            <p style={{ margin: '.15rem 0 0', color: 'var(--muted)', fontSize: '.8rem' }}>
              Lo que te escriban entra en Chats, pestaña WhatsApp.
            </p>
          </div>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '.4rem', fontSize: '.82rem', fontWeight: 700, color: meta.color }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: meta.color, boxShadow: `0 0 8px ${meta.color}` }} />
            {meta.txt}
          </span>
        </div>
      </div>

      {care && (
        <div className="card" style={{ padding: '.85rem 1.1rem', border: '1px solid rgba(239,68,68,.45)', background: 'rgba(239,68,68,.08)', color: '#fca5a5', fontSize: '.82rem', fontWeight: 600 }}>
          {care}
        </div>
      )}

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '.85rem 1.1rem', borderBottom: '1px solid var(--border)' }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: '.88rem' }}>Líneas</div>
            <div style={{ color: 'var(--muted)', fontSize: '.72rem', marginTop: 2 }}>Por ahora una. Más adelante se pueden sumar otras.</div>
          </div>
          <button type="button" disabled title="Todavía no se pueden sumar más líneas"
            style={{ padding: '.38rem .75rem', fontSize: '.75rem', fontWeight: 700, borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--muted)', cursor: 'not-allowed' }}>
            + Agregar número
          </button>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th}>Número</th>
                <th style={th}>Estado</th>
                <th style={th}>Vínculo</th>
                <th style={th}>Socket</th>
                <th style={th}>Salud</th>
                <th style={th}>Aviso</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={cell}>
                  <div style={{ fontWeight: 700 }}>{state?.phone ?? '—'}</div>
                  {state?.device ? <div style={{ color: 'var(--muted)', fontSize: '.68rem', marginTop: 2 }}>{state.device}</div> : null}
                </td>
                <td style={{ ...cell, color: meta.color, fontWeight: 700 }}>{meta.txt}</td>
                <td style={cell}>{state?.authenticationStatus ? (AUTH_LABEL[state.authenticationStatus] ?? state.authenticationStatus) : '—'}</td>
                <td style={cell}>{state?.connectionStatus ? (SOCK_LABEL[state.connectionStatus] ?? state.connectionStatus) : '—'}</td>
                <td style={cell}>{state?.sessionHealth ?? '—'}</td>
                <td style={{ ...cell, color: 'var(--muted)', maxWidth: 220 }}>
                  {state?.lastError || state?.lastCausalEvent || '—'}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {connected ? (
        <div className="card" style={{ padding: '1.1rem 1.2rem' }}>
          <p style={{ fontWeight: 600, margin: '0 0 .45rem' }}>
            {state?.phone ? `${state.phone} está vinculado.` : 'El número está vinculado.'}
          </p>
          <ul style={{ color: 'var(--muted)', fontSize: '.8rem', lineHeight: 1.6, margin: 0, paddingLeft: '1.1rem' }}>
            <li>No cierres la sesión desde el teléfono ni saques el dispositivo vinculado.</li>
            <li>El teléfono tiene que prender y entrar a internet cada tanto.</li>
            <li>Solo llegan las conversaciones de a uno. Grupos y estados no entran.</li>
            <li>Llegan los mensajes nuevos. Lo anterior a la vinculación no se trae.</li>
          </ul>
        </div>
      ) : (
        <div className="card" style={{ padding: '1.2rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '.9rem' }}>
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
        </div>
      )}
    </div>
  );
}

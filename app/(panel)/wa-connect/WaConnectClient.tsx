'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type WaLine = {
  sessionId: string;
  status: string;
  phone: string | null;
  link: string | null;
  device: string | null;
  connectionStatus: string | null;
  authenticationStatus: string | null;
  lastCausalEvent: string | null;
  sessionHealth: string | null;
  lastError: string | null;
  qr: string | null;
};

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

function careNote(line: WaLine): string | null {
  if (line.authenticationStatus !== 'revoked') return null;
  const cause = line.lastCausalEvent?.trim();
  return cause
    ? `El vínculo de ${line.phone ?? 'un número'} quedó revocado (${cause}).`
    : `El vínculo de ${line.phone ?? 'un número'} quedó revocado.`;
}

const WaLogo = ({ size = 28 }: { size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="#25D366" aria-hidden>
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
  </svg>
);

export function WaConnectClient() {
  const [enabled, setEnabled] = useState(false);
  const [lines, setLines] = useState<WaLine[]>([]);
  const [max, setMax] = useState(5);
  const [sel, setSel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [waitingQr, setWaitingQr] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const aliveRef = useRef(true);

  const pull = useCallback(async (fresh = false) => {
    try {
      const d = await fetch(`/api/panel/wa-status${fresh ? '?fresh=1' : ''}`).then((r) => r.json());
      if (!aliveRef.current) return;
      setLoaded(true);
      setEnabled(!!d?.enabled);
      setMax(typeof d?.max === 'number' ? d.max : 5);
      const next: WaLine[] = Array.isArray(d?.lines) ? d.lines : [];
      setLines(next);
      setSel((prev) => {
        if (prev && next.some((l) => l.sessionId === prev)) return prev;
        const waiting = next.find((l) => l.status !== 'connected');
        return waiting?.sessionId ?? next[0]?.sessionId ?? null;
      });
    } catch { /* ignora */ }
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    pull(true);
    return () => { aliveRef.current = false; };
  }, [pull]);

  const allOn = lines.length > 0 && lines.every((l) => l.status === 'connected');
  useEffect(() => {
    const ms = allOn ? 30000 : waitingQr ? 1500 : 3500;
    const t = setInterval(() => pull(true), ms);
    return () => clearInterval(t);
  }, [allOn, waitingQr, pull]);

  const selected = lines.find((l) => l.sessionId === sel) ?? null;
  const qrSrc = selected?.qr
    ? (selected.qr.startsWith('data:') ? selected.qr : `data:image/png;base64,${selected.qr}`)
    : null;
  const pendingStatuses = new Set(['connecting', 'qr', 'reconnecting', 'waiting_reconnect']);
  const linePending = !!selected && selected.status !== 'connected' && (
    pendingStatuses.has(selected.status)
    || selected.sessionHealth === 'requires_qr'
    || selected.authenticationStatus === 'pairing'
  );
  const loadingQr = !qrSrc && (waitingQr || busy || adding || linePending);

  useEffect(() => {
    if (qrSrc || selected?.status === 'connected') setWaitingQr(false);
  }, [qrSrc, selected?.status]);

  const connect = async (sessionId: string) => {
    if (loadingQr) return;
    setBusy(true);
    setWaitingQr(true);
    setErr(null);
    try {
      const r = await fetch('/api/panel/wa-reconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      }).then((x) => x.json()).catch(() => null);
      if (r && r.ok === false) {
        setErr(r.error ?? 'no se pudo generar el QR');
        setWaitingQr(false);
      }
      setTimeout(() => pull(true), 1200);
      setTimeout(() => pull(true), 3500);
    } finally {
      setBusy(false);
    }
  };

  const addLine = async () => {
    setAdding(true);
    setWaitingQr(true);
    setErr(null);
    try {
      const r = await fetch('/api/panel/wa-add', { method: 'POST' }).then((x) => x.json()).catch(() => null);
      if (!r?.ok) {
        setErr(r?.error ?? 'no se pudo agregar');
        setWaitingQr(false);
        return;
      }
      if (typeof r.sessionId === 'string') setSel(r.sessionId);
      await pull(true);
    } finally {
      setAdding(false);
    }
  };

  const copyLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(url);
      setTimeout(() => setCopied((c) => (c === url ? null : c)), 1600);
    } catch { /* ignore */ }
  };

  const headerMeta = allOn
    ? STATUS_LABEL.connected
    : (STATUS_LABEL[selected?.status ?? 'unknown'] ?? STATUS_LABEL.unknown);
  const cares = lines.map(careNote).filter((x): x is string => !!x);
  const selectedOn = selected?.status === 'connected';
  const canAdd = enabled && lines.length < max && !adding;

  if (loaded && !enabled) {
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
    <div style={{ maxWidth: 1080, margin: '1.2rem auto', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div className="card" style={{ padding: '1.15rem 1.3rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '.7rem' }}>
          <WaLogo size={32} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: '1.15rem' }}>WhatsApp</h2>
            <p style={{ margin: '.15rem 0 0', color: 'var(--muted)', fontSize: '.8rem' }}>
              Lo que te escriban entra en Chats, pestaña WhatsApp.
            </p>
          </div>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '.4rem', fontSize: '.82rem', fontWeight: 700, color: headerMeta.color }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: headerMeta.color, boxShadow: `0 0 8px ${headerMeta.color}` }} />
            {lines.length ? `${lines.filter((l) => l.status === 'connected').length}/${lines.length} vinculadas` : headerMeta.txt}
          </span>
        </div>
      </div>

      {cares.map((c) => (
        <div key={c} className="card" style={{ padding: '.85rem 1.1rem', border: '1px solid rgba(239,68,68,.45)', background: 'rgba(239,68,68,.08)', color: '#fca5a5', fontSize: '.82rem', fontWeight: 600 }}>
          {c}
        </div>
      ))}

      {err && (
        <div className="card" style={{ padding: '.75rem 1.1rem', color: '#fca5a5', fontSize: '.82rem', fontWeight: 600 }}>{err}</div>
      )}

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '.85rem 1.1rem', borderBottom: '1px solid var(--border)' }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: '.88rem' }}>Líneas</div>
            <div style={{ color: 'var(--muted)', fontSize: '.72rem', marginTop: 2 }}>Hasta {max} números. El link abre el chat de ese número.</div>
          </div>
          <button
            type="button"
            disabled={!canAdd || adding}
            title={canAdd ? 'Sumar otra línea' : `Tope de ${max}`}
            onClick={addLine}
            style={{
              padding: '.38rem .75rem', fontSize: '.75rem', fontWeight: 700, borderRadius: 8,
              border: '1px solid var(--border)',
              background: canAdd ? '#25D366' : 'transparent',
              color: canAdd ? '#fff' : 'var(--muted)',
              cursor: canAdd ? 'pointer' : 'not-allowed',
            }}>
            {adding ? 'Cargando…' : '+ Agregar número'}
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
                <th style={{ ...th, textAlign: 'right' }}>Link</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => {
                const waitingThis = !line.qr && line.status !== 'connected' && (
                  (sel === line.sessionId && (waitingQr || busy || adding))
                  || pendingStatuses.has(line.status)
                  || line.sessionHealth === 'requires_qr'
                  || line.authenticationStatus === 'pairing'
                );
                const meta = waitingThis && !line.qr
                  ? { txt: 'Cargando…', color: '#f59e0b' }
                  : (STATUS_LABEL[line.status] ?? STATUS_LABEL.unknown);
                const active = line.sessionId === sel;
                return (
                  <tr
                    key={line.sessionId}
                    onClick={() => setSel(line.sessionId)}
                    style={{ cursor: 'pointer', background: active ? 'rgba(37,211,102,.08)' : undefined }}>
                    <td style={cell}>
                      <div style={{ fontWeight: 700 }}>{line.phone ?? 'Pendiente de vincular'}</div>
                      {line.device ? <div style={{ color: 'var(--muted)', fontSize: '.68rem', marginTop: 2 }}>{line.device}</div> : null}
                    </td>
                    <td style={{ ...cell, color: meta.color, fontWeight: 700 }}>{meta.txt}</td>
                    <td style={cell}>{line.authenticationStatus ? (AUTH_LABEL[line.authenticationStatus] ?? line.authenticationStatus) : '—'}</td>
                    <td style={cell}>{line.connectionStatus ? (SOCK_LABEL[line.connectionStatus] ?? line.connectionStatus) : '—'}</td>
                    <td style={cell}>{line.sessionHealth ?? '—'}</td>
                    <td style={{ ...cell, color: 'var(--muted)', maxWidth: 180 }}>
                      {line.lastError || line.lastCausalEvent || '—'}
                    </td>
                    <td style={{ ...cell, textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                      {line.link ? (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '.45rem' }}>
                          <span style={{ color: 'var(--muted)', fontSize: '.68rem', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }} title={line.link}>
                            {line.link.replace(/^https:\/\//, '')}
                          </span>
                          <button
                            type="button"
                            onClick={() => copyLink(line.link!)}
                            title={line.link}
                            style={{
                              padding: '.28rem .55rem', fontSize: '.72rem', fontWeight: 700, borderRadius: 7,
                              border: '1px solid var(--border)', background: 'transparent', color: 'var(--text)', cursor: 'pointer',
                            }}>
                            {copied === line.link ? 'Copiado' : 'Copiar'}
                          </button>
                        </div>
                      ) : (
                        <span style={{ color: 'var(--muted)' }}>—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {selectedOn ? (
        <div className="card" style={{ padding: '1.1rem 1.2rem' }}>
          <p style={{ fontWeight: 600, margin: '0 0 .45rem' }}>
            {selected?.phone ? `${selected.phone} está vinculado.` : 'El número está vinculado.'}
          </p>
          <ul style={{ color: 'var(--muted)', fontSize: '.8rem', lineHeight: 1.6, margin: 0, paddingLeft: '1.1rem' }}>
            <li>No cierres la sesión desde el teléfono ni saques el dispositivo vinculado.</li>
            <li>El teléfono tiene que prender y entrar a internet cada tanto.</li>
            <li>Solo llegan las conversaciones de a uno. Grupos y estados no entran.</li>
            <li>Llegan los mensajes nuevos. Lo anterior a la vinculación no se trae.</li>
          </ul>
        </div>
      ) : selected ? (
        <div className="card" style={{ padding: '1.2rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '.9rem' }}>
          <div style={{ width: 256, height: 256, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '.55rem', background: qrSrc ? '#fff' : 'var(--bg-2, rgba(255,255,255,.03))', borderRadius: 14, border: '1px solid var(--border)' }}>
            {qrSrc
              ? <img alt="QR de WhatsApp" src={qrSrc} style={{ width: 236, height: 236 }} />
              : (
                <>
                  <span style={{ color: loadingQr ? '#f59e0b' : 'var(--muted)', fontSize: '.88rem', fontWeight: 700, textAlign: 'center', padding: '0 1rem' }}>
                    {loadingQr ? 'Cargando…' : 'Todavía no hay código'}
                  </span>
                  {loadingQr && (
                    <span style={{ color: 'var(--muted)', fontSize: '.75rem', textAlign: 'center', padding: '0 1.2rem', lineHeight: 1.4 }}>
                      Esperá el QR. No toques Conectar: si lo reiniciás, WhatsApp puede cortar la línea.
                    </span>
                  )}
                </>
              )}
          </div>
          <ol style={{ color: 'var(--muted)', fontSize: '.82rem', lineHeight: 1.5, margin: 0, paddingLeft: '1.1rem', alignSelf: 'stretch' }}>
            <li>Abrí WhatsApp en el teléfono de esta línea.</li>
            <li>Ajustes → Dispositivos vinculados → Vincular un dispositivo.</li>
            <li>Escaneá este código. Si da error, generá uno nuevo: caduca a los segundos.</li>
          </ol>
          {loadingQr ? (
            <div style={{ padding: '.5rem 1.1rem', fontSize: '.85rem', fontWeight: 700, color: '#f59e0b' }}>Cargando…</div>
          ) : (
            <button type="button" disabled={busy} onClick={() => connect(selected.sessionId)} style={{ padding: '.5rem 1.1rem', fontSize: '.85rem', fontWeight: 700, borderRadius: 9, border: 'none', background: '#25D366', color: '#fff', cursor: 'pointer' }}>
              {qrSrc ? 'Generar nuevo QR' : 'Conectar'}
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type WaLine = {
  sessionId: string;
  status: string;
  phone: string | null;
  link: string | null;
  linked?: boolean;
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
  if (line.authenticationStatus !== 'revoked' || !line.phone) return null;
  if (line.status === 'disconnected') return null;
  const cause = line.lastCausalEvent?.trim();
  return cause
    ? `El vínculo de ${line.phone} quedó revocado (${cause}).`
    : `El vínculo de ${line.phone} quedó revocado.`;
}

function qrSrcOf(line: WaLine | null): string | null {
  if (!line?.qr) return null;
  return line.qr.startsWith('data:') ? line.qr : `data:image/png;base64,${line.qr}`;
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
  const [draftId, setDraftId] = useState<string | null>(null);
  const [draft, setDraft] = useState<WaLine | null>(null);
  const [adding, setAdding] = useState(false);
  const [waitingQr, setWaitingQr] = useState(false);
  const [dropping, setDropping] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const lastPhoneRef = useRef<Record<string, string>>({});
  const aliveRef = useRef(true);
  const committedRef = useRef<string | null>(null);

  const pull = useCallback(async (fresh = false, draftSession?: string | null) => {
    const useDraft = draftSession !== undefined ? draftSession : draftId;
    const draftQ = useDraft ? `&draft=${encodeURIComponent(useDraft)}` : '';
    try {
      const d = await fetch(`/api/panel/wa-status?${fresh ? 'fresh=1' : 'ok=1'}${draftQ}`).then((r) => r.json());
      if (!aliveRef.current) return;
      setLoaded(true);
      setEnabled(!!d?.enabled);
      setMax(typeof d?.max === 'number' ? d.max : 5);
      const nextLines: WaLine[] = Array.isArray(d?.lines) ? d.lines : [];
      for (const line of nextLines) {
        if (line.phone) lastPhoneRef.current[line.sessionId] = line.phone;
        else if (lastPhoneRef.current[line.sessionId]) line.phone = lastPhoneRef.current[line.sessionId];
      }
      setLines(nextLines);
      if (d?.draft && typeof d.draft.sessionId === 'string') setDraft(d.draft);
      else if (!useDraft) setDraft(null);
    } catch { /* ignora */ }
  }, [draftId]);

  useEffect(() => {
    aliveRef.current = true;
    pull(true);
    return () => { aliveRef.current = false; };
  }, [pull]);

  useEffect(() => {
    const pairing = !!draftId;
    const ms = pairing ? 1500 : 30000;
    const t = setInterval(() => pull(true, draftId), ms);
    return () => clearInterval(t);
  }, [draftId, pull]);

  useEffect(() => {
    if (draft?.qr) setWaitingQr(false);
    if (draft?.status === 'connected' || draft?.linked) setWaitingQr(false);
  }, [draft?.qr, draft?.status, draft?.linked]);

  useEffect(() => {
    const id = draft?.sessionId;
    if (!id || committedRef.current === id) return;
    if (!(draft.linked || draft.status === 'connected')) return;
    committedRef.current = id;
    fetch('/api/panel/wa-commit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: id }),
    }).then((r) => r.json()).then((d) => {
      if (!d?.ok) { committedRef.current = null; return; }
      setDraftId(null);
      setDraft(null);
      pull(true, null);
    }).catch(() => { committedRef.current = null; });
  }, [draft, pull]);

  useEffect(() => {
    if (!waitingQr) return;
    const t = setTimeout(() => {
      setWaitingQr(false);
      setErr((e) => e ?? 'El QR tardó. Cancelá e intentá de nuevo, no toques Conectar en ráfaga.');
    }, 45000);
    return () => clearTimeout(t);
  }, [waitingQr]);

  const addLine = async () => {
    if (draftId || adding) return;
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
      setDraftId(r.sessionId);
      await pull(true, r.sessionId);
    } finally {
      setAdding(false);
    }
  };

  const cancelDraft = async () => {
    if (!draftId) { setDraft(null); setWaitingQr(false); return; }
    setDropping(draftId);
    try {
      await fetch('/api/panel/wa-remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: draftId }),
      });
      setDraftId(null);
      setDraft(null);
      setWaitingQr(false);
    } finally {
      setDropping(null);
    }
  };

  const disconnect = async (sessionId: string, phone: string | null) => {
    if (!window.confirm(`¿Desconectar ${phone ?? 'esta línea'}? Se desvincula y sale de la lista.`)) return;
    setDropping(sessionId);
    setErr(null);
    try {
      const r = await fetch('/api/panel/wa-disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      }).then((x) => x.json()).catch(() => null);
      if (!r?.ok) { setErr(r?.error ?? 'no se pudo desconectar'); return; }
      await pull(true);
    } finally {
      setDropping(null);
    }
  };

  const removeLine = async (sessionId: string, phone: string | null) => {
    if (!window.confirm(`¿Eliminar ${phone ?? 'esta línea'} de la lista?`)) return;
    setDropping(sessionId);
    setErr(null);
    try {
      const r = await fetch('/api/panel/wa-remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      }).then((x) => x.json()).catch(() => null);
      if (!r?.ok) { setErr(r?.error ?? 'no se pudo eliminar'); return; }
      await pull(true);
    } finally {
      setDropping(null);
    }
  };

  const copyLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(url);
      setTimeout(() => setCopied((c) => (c === url ? null : c)), 1600);
    } catch { /* ignore */ }
  };

  const pairing = !!draftId;
  const qrSrc = qrSrcOf(draft);
  const loadingQr = pairing && !qrSrc && (waitingQr || adding);
  const headerMeta = lines.some((l) => l.status === 'connected')
    ? STATUS_LABEL.connected
    : STATUS_LABEL.unknown;
  const cares = lines.map(careNote).filter((x): x is string => !!x);
  const canAdd = enabled && lines.length < max && !adding && !pairing;

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
            {`${lines.filter((l) => l.status === 'connected').length}/${lines.length || 0} vinculadas`}
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
            <div style={{ color: 'var(--muted)', fontSize: '.72rem', marginTop: 2 }}>Hasta {max}. Solo se guarda cuando el número ya está vinculado.</div>
          </div>
          <button
            type="button"
            disabled={!canAdd}
            title={canAdd ? 'Sumar otra línea' : pairing ? 'Terminá o cancelá el QR' : `Tope de ${max}`}
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
                <th style={{ ...th, textAlign: 'right' }}>Acción</th>
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 && (
                <tr>
                  <td style={{ ...cell, color: 'var(--muted)' }} colSpan={8}>Ningún número vinculado todavía.</td>
                </tr>
              )}
              {lines.map((line) => {
                const on = line.status === 'connected';
                const meta = STATUS_LABEL[line.status] ?? STATUS_LABEL.unknown;
                return (
                  <tr key={line.sessionId}>
                    <td style={cell}>
                      <div style={{ fontWeight: 700 }}>{line.phone ?? '—'}</div>
                    </td>
                    <td style={{ ...cell, color: meta.color, fontWeight: 700 }}>{meta.txt}</td>
                    <td style={cell}>{line.authenticationStatus ? (AUTH_LABEL[line.authenticationStatus] ?? line.authenticationStatus) : '—'}</td>
                    <td style={cell}>{line.connectionStatus ? (SOCK_LABEL[line.connectionStatus] ?? line.connectionStatus) : '—'}</td>
                    <td style={cell}>{line.sessionHealth ?? '—'}</td>
                    <td style={{ ...cell, color: 'var(--muted)', maxWidth: 180 }}>
                      {line.lastError || line.lastCausalEvent || '—'}
                    </td>
                    <td style={{ ...cell, textAlign: 'right' }}>
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
                    <td style={{ ...cell, textAlign: 'right' }}>
                      {on ? (
                        <button
                          type="button"
                          disabled={dropping === line.sessionId}
                          onClick={() => disconnect(line.sessionId, line.phone)}
                          style={{
                            padding: '.28rem .55rem', fontSize: '.72rem', fontWeight: 700, borderRadius: 7,
                            border: '1px solid rgba(239,68,68,.45)', background: 'transparent', color: '#fca5a5',
                            cursor: 'pointer',
                          }}>
                          {dropping === line.sessionId ? 'Cargando…' : 'Desconectar'}
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={dropping === line.sessionId}
                          onClick={() => removeLine(line.sessionId, line.phone)}
                          style={{
                            padding: '.28rem .55rem', fontSize: '.72rem', fontWeight: 700, borderRadius: 7,
                            border: '1px solid rgba(239,68,68,.45)', background: 'transparent', color: '#fca5a5',
                            cursor: 'pointer',
                          }}>
                          {dropping === line.sessionId ? 'Cargando…' : 'Eliminar'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {pairing && (
        <div className="card" style={{ padding: '1.2rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '.9rem' }}>
          <div style={{ width: 256, height: 256, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '.55rem', background: qrSrc ? '#fff' : 'var(--bg-2, rgba(255,255,255,.03))', borderRadius: 14, border: '1px solid var(--border)' }}>
            {qrSrc
              ? <img alt="QR de WhatsApp" src={qrSrc} style={{ width: 236, height: 236 }} />
              : (
                <>
                  <span style={{ color: '#f59e0b', fontSize: '.88rem', fontWeight: 700 }}>Cargando…</span>
                  <span style={{ color: 'var(--muted)', fontSize: '.75rem', textAlign: 'center', padding: '0 1.2rem', lineHeight: 1.4 }}>
                    Esperá el QR. No reinicies: WhatsApp puede cortar la línea.
                  </span>
                </>
              )}
          </div>
          <ol style={{ color: 'var(--muted)', fontSize: '.82rem', lineHeight: 1.5, margin: 0, paddingLeft: '1.1rem', alignSelf: 'stretch' }}>
            <li>Abrí WhatsApp en el teléfono de esta línea.</li>
            <li>Ajustes → Dispositivos vinculados → Vincular un dispositivo.</li>
            <li>Escaneá este código. Si da error, cancelá y agregá de nuevo.</li>
          </ol>
          {loadingQr ? (
            <div style={{ padding: '.5rem 1.1rem', fontSize: '.85rem', fontWeight: 700, color: '#f59e0b' }}>Cargando…</div>
          ) : null}
          <button
            type="button"
            disabled={dropping === draftId}
            onClick={cancelDraft}
            style={{ padding: '.45rem .9rem', fontSize: '.8rem', fontWeight: 700, borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--muted)', cursor: 'pointer' }}>
            Cancelar
          </button>
        </div>
      )}
    </div>
  );
}

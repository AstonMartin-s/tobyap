'use client';
import { useEffect, useState } from 'react';

// Panel de CREACIÓN MANUAL de usuario (provider='manual': goldenC/ElGanador).
// Se monta SOLO cuando el tenant es manual y la sesión está en 'account_pending'.
// Muestra usuario/contraseña SUGERIDOS (editables). El operador crea la cuenta a
// mano en la plataforma del cliente y toca "Confirmar creación": recién ahí el
// cliente recibe las credenciales y el flujo sigue igual (CBU → comprobante…).

export default function ManualAccountPanel({
  sessionKey,
  suggestedUsername,
  suggestedPassword,
  onDone,
}: {
  sessionKey: string;
  suggestedUsername: string;
  suggestedPassword: string;
  onDone?: () => void;
}) {
  const [username, setUsername] = useState(suggestedUsername);
  const [password, setPassword] = useState(suggestedPassword);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // Reset al cambiar de chat / sugerencia.
  useEffect(() => {
    setUsername(suggestedUsername);
    setPassword(suggestedPassword);
    setConfirming(false);
    setMsg(null);
  }, [sessionKey, suggestedUsername, suggestedPassword]);

  async function confirm() {
    const u = username.trim();
    const p = password.trim();
    if (!u || !p) { setMsg({ kind: 'err', text: 'completá usuario y contraseña' }); return; }
    setBusy(true); setMsg(null);
    const r = await fetch('/api/panel/chats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionKey, op: 'manual_account_confirm', username: u, password: p }),
    }).then((x) => x.json()).catch(() => null);
    setBusy(false); setConfirming(false);
    if (!r?.ok) { setMsg({ kind: 'err', text: r?.error ?? 'no se pudo confirmar' }); return; }
    setMsg({ kind: 'ok', text: 'Credenciales enviadas al cliente ✓' });
    onDone?.();
  }

  const box: React.CSSProperties = { border: '1px solid var(--border)', borderRadius: 10, padding: '.6rem .7rem', background: 'var(--card-2, rgba(255,255,255,.02))' };
  const lbl: React.CSSProperties = { fontSize: '.6rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--muted-2,#5d6478)' };
  const inputStyle: React.CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '.55rem .7rem', fontSize: 16, marginTop: '.25rem' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '.6rem' }}>
      <div style={box}>
        <div style={{ fontSize: '.72rem', color: 'var(--muted)', lineHeight: 1.4 }}>
          Creá la cuenta a mano en la plataforma con estos datos (o editalos) y tocá
          <b> Confirmar creación</b>. Recién ahí el cliente recibe sus credenciales.
        </div>
      </div>

      <div style={box}>
        <div style={lbl}>Usuario</div>
        <input className="input" value={username} disabled={busy}
          onChange={(e) => setUsername(e.target.value.replace(/\s/g, ''))} style={inputStyle} />
      </div>
      <div style={box}>
        <div style={lbl}>Contraseña</div>
        <input className="input" value={password} disabled={busy}
          onChange={(e) => setPassword(e.target.value)} style={inputStyle} />
      </div>

      {!confirming ? (
        <button disabled={busy} onClick={() => { setMsg(null); setConfirming(true); }}
          style={{ padding: '.55rem', borderRadius: 8, border: 'none', background: '#16a34a', color: '#fff', fontWeight: 700, fontSize: '.85rem', cursor: 'pointer' }}>
          Confirmar creación
        </button>
      ) : (
        <div style={{ ...box, borderColor: '#16a34a', display: 'flex', flexDirection: 'column', gap: '.4rem' }}>
          <div style={{ fontSize: '.82rem', fontWeight: 700 }}>¿Ya creaste la cuenta en la plataforma?</div>
          <div style={{ fontSize: '.7rem', color: 'var(--muted)' }}>Se le enviarán al cliente estas credenciales y podrá pedir el CBU.</div>
          <div style={{ display: 'flex', gap: '.5rem' }}>
            <button disabled={busy} onClick={confirm}
              style={{ flex: 1, padding: '.45rem', borderRadius: 8, border: 'none', background: '#16a34a', color: '#fff', fontWeight: 700, fontSize: '.82rem', cursor: 'pointer' }}>
              {busy ? 'Enviando…' : 'Sí, enviar credenciales'}
            </button>
            <button disabled={busy} onClick={() => setConfirming(false)}
              style={{ flex: 1, padding: '.45rem', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--muted)', fontWeight: 600, fontSize: '.82rem', cursor: 'pointer' }}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {msg && (
        <div style={{ fontSize: '.75rem', fontWeight: 600, color: msg.kind === 'ok' ? '#16a34a' : '#ef4444' }}>{msg.text}</div>
      )}
    </div>
  );
}

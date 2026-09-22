'use client';

import { useState } from 'react';

export function CopyPassword({ slug, value }: { slug: string; value: string | null }) {
  const [saved, setSaved] = useState<string | null>(value);
  const [draft, setDraft] = useState('');
  const [state, setState] = useState<'idle' | 'ok' | 'err' | 'busy'>('idle');
  const [err, setErr] = useState('');

  async function save() {
    const next = draft.trim();
    if (next.length < 6) {
      setErr('mínimo 6');
      return;
    }
    setState('busy');
    setErr('');
    const r = await fetch(`/api/admin/tenant/${slug}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ panelPassword: next }),
    });
    if (!r.ok) {
      const body = (await r.json().catch(() => ({}))) as { error?: string };
      setErr(body.error || 'no se guardó');
      setState('idle');
      return;
    }
    setSaved(next);
    setDraft('');
    setState('idle');
  }

  async function copy() {
    if (!saved) return;
    try {
      await navigator.clipboard.writeText(saved);
      setState('ok');
    } catch {
      setState('err');
    }
    window.setTimeout(() => setState('idle'), 1400);
  }

  if (!saved) {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}
      >
        <input
          className="input"
          type="password"
          name={`panel-pass-${slug}`}
          autoComplete="new-password"
          value={draft}
          placeholder="Agregar"
          aria-label={`Contraseña de ${slug}`}
          title="Queda guardada y pasa a ser la clave del panel"
          onChange={(e) => {
            setDraft(e.target.value);
            setErr('');
          }}
          style={{ width: 118, padding: '4px 8px', fontSize: 12 }}
        />
        <button type="submit" className="btn btn--ghost btn--sm" disabled={state === 'busy'} style={{ padding: '4px 8px' }}>
          {state === 'busy' ? '…' : 'Guardar'}
        </button>
        {err ? <span style={{ color: 'var(--danger)', fontSize: 11 }}>{err}</span> : null}
      </form>
    );
  }

  return (
    <button
      type="button"
      onClick={copy}
      title="Copiar contraseña"
      aria-label="Copiar contraseña"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        background: 'transparent',
        border: '1px solid var(--border-2)',
        color: 'var(--text)',
        borderRadius: 8,
        padding: '4px 8px',
        cursor: 'pointer',
        fontSize: 12,
      }}
    >
      <span aria-hidden style={{ letterSpacing: 1, color: 'var(--muted)' }}>••••••••</span>
      <span>{state === 'ok' ? 'Copiada' : state === 'err' ? 'No se pudo' : 'Copiar'}</span>
    </button>
  );
}

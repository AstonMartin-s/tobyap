'use client';

import { useState } from 'react';

export function CopyPassword({ value }: { value: string | null }) {
  const [state, setState] = useState<'idle' | 'ok' | 'err'>('idle');

  if (!value) {
    return (
      <span style={{ color: 'var(--muted)' }} title="Se guarda al cambiar la clave del panel">
        —
      </span>
    );
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(value as string);
      setState('ok');
    } catch {
      setState('err');
    }
    window.setTimeout(() => setState('idle'), 1400);
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

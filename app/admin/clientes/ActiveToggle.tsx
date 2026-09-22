'use client';

import { useState } from 'react';

export function ActiveToggle({ slug, active }: { slug: string; active: boolean }) {
  const [on, setOn] = useState(active);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    const next = !on;
    setBusy(true);
    const r = await fetch(`/api/admin/tenant/${slug}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: next }),
    });
    setBusy(false);
    if (r.ok) setOn(next);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      aria-pressed={on}
      title={on ? 'Pasar a inactivo' : 'Pasar a activo'}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '2px 8px 2px 3px',
        borderRadius: 999,
        border: 'none',
        cursor: busy ? 'wait' : 'pointer',
        background: on ? 'var(--success-soft)' : 'rgba(139,151,167,0.12)',
        color: on ? 'var(--success)' : 'var(--muted)',
        font: 'inherit',
        fontSize: '0.72rem',
        fontWeight: 550,
        lineHeight: 1,
        opacity: busy ? 0.6 : 1,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 28,
          height: 16,
          borderRadius: 999,
          background: on ? 'var(--success)' : 'rgba(139,151,167,0.45)',
          position: 'relative',
          flex: '0 0 auto',
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: 2,
            left: on ? 14 : 2,
            width: 12,
            height: 12,
            borderRadius: 999,
            background: '#fff',
          }}
        />
      </span>
      {on ? 'activo' : 'inactivo'}
    </button>
  );
}

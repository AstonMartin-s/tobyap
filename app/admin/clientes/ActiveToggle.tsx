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
      title={on ? 'Pasar a inactivo' : 'Pasar a activo'}
      className={on ? 'badge badge--green' : 'badge badge--muted'}
      style={{ cursor: busy ? 'wait' : 'pointer', border: 'none' }}
    >
      {on ? 'activo' : 'inactivo'}
    </button>
  );
}

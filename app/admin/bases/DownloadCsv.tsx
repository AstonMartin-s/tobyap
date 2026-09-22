'use client';

import { useState } from 'react';

export function DownloadCsv({ slug, disabled, compact }: { slug: string; disabled?: boolean; compact?: boolean }) {
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function download() {
    setErr('');
    setBusy(true);
    try {
      const r = await fetch(`/api/admin/bases?slug=${encodeURIComponent(slug)}`);
      if (!r.ok) {
        setErr('no se pudo bajar');
        return;
      }
      const blob = await r.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `base-${slug}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    } finally {
      setBusy(false);
    }
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <button
        type="button"
        className={compact ? 'btn btn--ghost btn--sm' : 'btn'}
        onClick={() => void download()}
        disabled={disabled || busy}
        title={disabled ? 'Este cliente no tiene números' : 'Descargar nombre y teléfono'}
      >
        {busy ? '…' : compact ? 'CSV' : 'Descargar CSV'}
      </button>
      {err ? <span style={{ color: 'var(--danger)', fontSize: 12 }}>{err}</span> : null}
    </span>
  );
}

'use client';

import { useState } from 'react';

export function DownloadCsv({ slug }: { slug: string }) {
  const [err, setErr] = useState('');

  async function download() {
    setErr('');
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
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <button type="button" className="btn" onClick={() => void download()}>Descargar CSV</button>
      {err ? <span style={{ color: 'var(--danger)', fontSize: 12 }}>{err}</span> : null}
    </span>
  );
}

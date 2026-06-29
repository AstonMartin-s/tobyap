'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function ConvertButton({ kommoLeadId, converted }: { kommoLeadId: number; converted: boolean }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(converted);

  async function convert() {
    if (done) return;
    if (!confirm(`¿Marcar como convertido (CargoCRM) el lead ${kommoLeadId}?`)) return;
    setLoading(true);
    const res = await fetch('/api/convert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kommoLeadId }),
    });
    setLoading(false);
    if (res.ok) { setDone(true); router.refresh(); }
    else alert('Error: ' + ((await res.json()).error ?? 'desconocido'));
  }

  if (done) return <span className="badge badge--green">✓ Convertido</span>;
  return (
    <button className="btn btn--sm" onClick={convert} disabled={loading}>
      {loading ? '…' : 'Marcar convertido'}
    </button>
  );
}

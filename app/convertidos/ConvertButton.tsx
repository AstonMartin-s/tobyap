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
    if (res.ok) {
      setDone(true);
      router.refresh();
    } else {
      alert('Error: ' + ((await res.json()).error ?? 'desconocido'));
    }
  }

  return (
    <button
      onClick={convert}
      disabled={loading || done}
      style={{
        padding: '0.35rem 0.7rem',
        borderRadius: 6,
        border: 'none',
        cursor: done ? 'default' : 'pointer',
        background: done ? '#1f3a24' : '#25d366',
        color: done ? '#7fd99a' : '#000',
        fontWeight: 700,
        fontSize: '0.78rem',
      }}
    >
      {done ? '✓ Convertido' : loading ? '...' : 'Marcar convertido'}
    </button>
  );
}

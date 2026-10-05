'use client';

import { useEffect } from 'react';

// Visor interno de imagen: overlay sobre el panel, cierra con ✕, click afuera o Escape.
// No abre pestaña nueva.
export function ImageZoom({ src, onClose }: { src: string | null; onClose: () => void }) {
  useEffect(() => {
    if (!src) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [src, onClose]);

  if (!src) return null;

  return (
    <div
      onClick={onClose}
      style={{ position: 'absolute', inset: 0, zIndex: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.78)', padding: '2.5rem 1.2rem', cursor: 'zoom-out' }}
    >
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        aria-label="Cerrar"
        style={{ position: 'absolute', top: 12, right: 14, width: 34, height: 34, borderRadius: '50%', border: '1px solid rgba(255,255,255,.25)', background: 'rgba(0,0,0,.5)', color: '#fff', fontSize: '1.1rem', lineHeight: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >
        ✕
      </button>
      <img
        src={src}
        alt=""
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: '100%', maxHeight: '100%', borderRadius: 10, objectFit: 'contain', boxShadow: '0 10px 40px rgba(0,0,0,.5)' }}
      />
    </div>
  );
}

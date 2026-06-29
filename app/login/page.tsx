'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user, password }),
    });
    setLoading(false);
    const data = await res.json();
    if (res.ok) router.push(data.role === 'admin' ? '/admin' : '/reportes');
    else setError(data.error ?? 'Error');
  }

  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: '1rem' }}>
      <div className="card" style={{ width: '100%', maxWidth: 380, margin: 0, padding: '2rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.7rem', marginBottom: '0.5rem' }}>
          <span className="sidebar__mark">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12h4l3 8 4-16 3 8h4" />
            </svg>
          </span>
          <span style={{ fontWeight: 800, fontSize: '1.3rem', letterSpacing: '-0.02em' }}>
            Tracker<span style={{ color: 'var(--accent)' }}>IO</span>
          </span>
        </div>
        <p style={{ color: 'var(--muted)', margin: '0 0 1.5rem', fontSize: '0.88rem' }}>Ingresá a tu panel.</p>
        <form onSubmit={submit}>
          <div className="field">
            <label>Usuario / email</label>
            <input className="input" value={user} onChange={(e) => setUser(e.target.value)} autoFocus />
          </div>
          <div className="field">
            <label>Contraseña</label>
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          {error && <p style={{ color: 'var(--danger)', fontSize: '0.84rem', margin: '0 0 0.8rem' }}>{error}</p>}
          <button className="btn" type="submit" disabled={loading} style={{ width: '100%', justifyContent: 'center', padding: '0.7rem' }}>
            {loading ? 'Ingresando…' : 'Entrar'}
          </button>
        </form>
      </div>
    </main>
  );
}

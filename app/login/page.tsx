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
    if (res.ok) router.push(data.role === 'admin' ? '/admin' : '/convertidos');
    else setError(data.error ?? 'Error');
  }

  const input: React.CSSProperties = {
    width: '100%',
    padding: '0.6rem 0.8rem',
    marginBottom: '0.75rem',
    borderRadius: 6,
    border: '1px solid #2a2f36',
    background: '#15181d',
    color: '#e7e9ec',
    boxSizing: 'border-box',
  };

  return (
    <main style={{ maxWidth: 360, margin: '12vh auto', padding: '0 1rem' }}>
      <h1 style={{ fontSize: '1.4rem', marginBottom: '1.5rem' }}>TOBYAP · Panel</h1>
      <form onSubmit={submit}>
        <input style={input} placeholder="Usuario" value={user} onChange={(e) => setUser(e.target.value)} />
        <input style={input} type="password" placeholder="Contraseña" value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <p style={{ color: '#ff6b6b', fontSize: '0.85rem' }}>{error}</p>}
        <button
          type="submit"
          disabled={loading}
          style={{ width: '100%', padding: '0.6rem', borderRadius: 6, border: 'none', background: '#25d366', color: '#000', fontWeight: 700, cursor: 'pointer' }}
        >
          {loading ? '...' : 'Entrar'}
        </button>
      </form>
    </main>
  );
}

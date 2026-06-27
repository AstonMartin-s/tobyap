'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

export function Nav({ slug, role = 'client' }: { slug: string; role?: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const isAdmin = role === 'admin';

  async function logout() {
    await fetch('/api/logout', { method: 'POST' });
    router.push('/login');
  }

  const link = (href: string, label: string) => {
    const active = pathname === href;
    return (
      <Link
        href={href}
        style={{
          padding: '0.4rem 0.8rem',
          borderRadius: 6,
          fontSize: '0.85rem',
          textDecoration: 'none',
          color: active ? '#000' : '#cfd3d9',
          background: active ? '#25d366' : 'transparent',
          fontWeight: active ? 700 : 500,
        }}
      >
        {label}
      </Link>
    );
  };

  return (
    <nav
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
        padding: '0.6rem 1rem',
        borderBottom: '1px solid #1c2026',
        marginBottom: '1.5rem',
      }}
    >
      <span style={{ fontWeight: 800, marginRight: '0.5rem' }}>
        TOBYAP{' '}
        <span style={{ color: isAdmin ? '#ffb84d' : '#25d366' }}>
          · {isAdmin ? 'admin' : slug}
        </span>
      </span>
      {isAdmin ? (
        <>
          {link('/admin', 'Reportes')}
          {link('/admin/clientes', 'Clientes')}
        </>
      ) : (
        <>
          {link('/convertidos', 'Convertidos')}
          {link('/config', 'Configuración')}
        </>
      )}
      <button
        onClick={logout}
        style={{
          marginLeft: 'auto',
          padding: '0.4rem 0.8rem',
          borderRadius: 6,
          border: '1px solid #2a2f36',
          background: 'transparent',
          color: '#8a93a0',
          cursor: 'pointer',
          fontSize: '0.8rem',
        }}
      >
        Salir
      </button>
    </nav>
  );
}

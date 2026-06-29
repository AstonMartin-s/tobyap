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

  const Link_ = (href: string, label: string) => (
    <Link href={href} className={`nav__link${pathname === href ? ' active' : ''}`}>
      {label}
    </Link>
  );

  return (
    <nav className="nav">
      <span className="nav__brand">
        <span className="nav__dot" /> TOBYAP
        <span style={{ color: isAdmin ? 'var(--warn)' : 'var(--accent)', fontWeight: 600, fontSize: '0.85rem' }}>
          · {isAdmin ? 'admin' : slug}
        </span>
      </span>
      {isAdmin ? (
        <>
          {Link_('/admin', 'Reportes')}
          {Link_('/admin/clientes', 'Clientes')}
        </>
      ) : (
        <>
          {Link_('/reportes', 'Reportes')}
          {Link_('/convertidos', 'Convertidos')}
          {Link_('/config', 'Configuración')}
        </>
      )}
      <span className="nav__spacer" />
      <button className="nav__logout" onClick={logout}>
        Cerrar sesión
      </button>
    </nav>
  );
}

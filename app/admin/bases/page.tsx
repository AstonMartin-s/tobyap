import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { baseGrowth, basePhones, listBases } from '@/lib/bases';
import { Nav } from '../../_components/Nav';
import { DownloadCsv } from './DownloadCsv';

export const dynamic = 'force-dynamic';

const STEP: Record<string, string> = {
  form: 'Formulario', welcome: 'Pidió usuario', credenciales: 'Usuario creado',
  cbu: 'Pidió CBU', comprobante: 'Pidió CBU', app_onboarding: 'Instalando app',
  validando: 'Revisar imagen', done: 'Cargo', no_cargo: 'No cargo', closed: 'Cerrado',
};

function when(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', dateStyle: 'short', timeStyle: 'short' });
}

export default async function BasesPage({ searchParams }: { searchParams: { tenant?: string } }) {
  const session = await getSession();
  if (!session) redirect('/login');
  if (session.role !== 'admin') redirect('/reportes');

  const bases = await listBases();
  const slug = searchParams.tenant?.trim() ?? '';
  const selected = bases.find((b) => b.slug === slug) ?? null;
  const phones = selected ? await basePhones(selected.slug) : [];
  const growth = selected ? await baseGrowth(selected.slug) : [];
  const shown = phones.slice(0, 200);

  return (
    <>
      <Nav slug={session.slug} role="admin" />
      <main className="shell">
        <div className="page-head">
          <div className="page-head__text">
            <h1>Bases</h1>
            <p>Números únicos que entraron al chat. Se guardan al empezar la conversación. Si el cliente no tiene Kommo, no se copian a ningún CRM: la base queda acá.</p>
          </div>
        </div>

        <div className="card">
          <table className="table">
            <thead>
              <tr>
                <th>Cliente</th>
                <th>Números</th>
                <th>Hoy</th>
                <th>7 días</th>
                <th>Chats</th>
                <th>En Kommo</th>
                <th>Lista</th>
              </tr>
            </thead>
            <tbody>
              {bases.map((b) => (
                <tr key={b.slug}>
                  <td>
                    <Link href={`/admin/bases?tenant=${b.slug}`} style={{ color: 'var(--accent)', fontWeight: 600 }}>{b.name}</Link>
                    <div style={{ color: 'var(--muted)', fontSize: 12 }}>{b.slug}</div>
                  </td>
                  <td>{b.uniquePhones.toLocaleString('es-AR')}</td>
                  <td>{b.newToday.toLocaleString('es-AR')}</td>
                  <td>{b.new7d.toLocaleString('es-AR')}</td>
                  <td style={{ color: 'var(--muted)' }}>{b.sessions.toLocaleString('es-AR')}</td>
                  <td>{b.hasKommo ? b.inKommo.toLocaleString('es-AR') : <span className="badge badge--muted">sin Kommo</span>}</td>
                  <td><DownloadCsv slug={b.slug} compact disabled={b.uniquePhones === 0} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {selected ? (
          <>
            <div className="page-head" style={{ marginTop: '1.5rem' }}>
              <div className="page-head__text">
                <h2 style={{ margin: 0 }}>{selected.name}</h2>
                <p>{selected.uniquePhones.toLocaleString('es-AR')} números únicos. {selected.newToday} nuevos hoy, {selected.new7d} en 7 días.</p>
              </div>
              <DownloadCsv slug={selected.slug} />
            </div>

            {!selected.hasKommo ? (
              <p style={{ color: 'var(--warn)', marginTop: 0 }}>Este cliente no tiene Kommo. Los números no están en el CRM: están solo en esta base.</p>
            ) : null}

            <div className="card">
              <table className="table">
                <thead><tr><th>Día</th><th>Nuevos</th><th>Acumulado</th></tr></thead>
                <tbody>
                  {[...growth].reverse().map((d) => (
                    <tr key={d.day}>
                      <td>{d.day.split('-').reverse().join('/')}</td>
                      <td>{d.nuevos.toLocaleString('es-AR')}</td>
                      <td>{d.acumulado.toLocaleString('es-AR')}</td>
                    </tr>
                  ))}
                  {!growth.length ? <tr><td colSpan={3} style={{ color: 'var(--muted)' }}>Todavía no entró ningún número.</td></tr> : null}
                </tbody>
              </table>
            </div>

            <div className="card" style={{ marginTop: '1rem' }}>
              <table className="table">
                <thead><tr><th>Teléfono</th><th>Nombre</th><th>Primero</th><th>Último</th><th>Estado</th><th>Campaña</th></tr></thead>
                <tbody>
                  {shown.map((p) => (
                    <tr key={p.phone}>
                      <td>{p.phone}</td>
                      <td>{p.name || '—'}</td>
                      <td style={{ color: 'var(--muted)' }}>{when(p.firstAt)}</td>
                      <td style={{ color: 'var(--muted)' }}>{when(p.lastAt)}</td>
                      <td>{STEP[p.step] ?? (p.step || '—')}</td>
                      <td style={{ color: 'var(--muted)' }}>{p.campaign || '—'}</td>
                    </tr>
                  ))}
                  {!shown.length ? <tr><td colSpan={6} style={{ color: 'var(--muted)' }}>Sin números.</td></tr> : null}
                </tbody>
              </table>
              {phones.length > shown.length ? (
                <p style={{ color: 'var(--muted)', fontSize: 13 }}>En pantalla van los 200 más recientes. El CSV trae los {phones.length.toLocaleString('es-AR')}.</p>
              ) : null}
            </div>
          </>
        ) : null}
      </main>
    </>
  );
}

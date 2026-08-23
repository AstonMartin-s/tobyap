'use client';

import { useEffect, useState } from 'react';

type User = {
  id: string;
  username: string;
  displayName: string | null;
  role: string;
  active: boolean;
  createdAt: string;
};

const ROLES = [
  { value: 'operador', label: 'Operador', desc: 'Solo Chats web (responder + fichas)' },
  { value: 'supervisor', label: 'Supervisor', desc: 'Todo menos Configuración y Usuarios' },
  { value: 'admin', label: 'Admin', desc: 'Acceso total' },
];

async function api(url: string, opts?: RequestInit) {
  const r = await fetch(url, opts);
  const d = await r.json();
  if (!r.ok) throw new Error(d.error ?? 'error');
  return d;
}

export function UsuariosClient() {
  const [users, setUsers] = useState<User[]>([]);
  const [msg, setMsg] = useState('');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ username: '', password: '', displayName: '', role: 'operador' });
  const [busy, setBusy] = useState(false);
  const [pwEdit, setPwEdit] = useState<string | null>(null);
  const [pwVal, setPwVal] = useState('');

  async function load() {
    try {
      const d = await api('/api/panel/usuarios');
      setUsers(d.users ?? []);
    } catch {
      setMsg('No se pudieron cargar los usuarios. Si es la primera vez, ejecutá la migración.');
    }
  }

  useEffect(() => { load(); }, []);

  async function create() {
    setBusy(true);
    setMsg('');
    try {
      await api('/api/panel/usuarios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      setForm({ username: '', password: '', displayName: '', role: 'operador' });
      setOpen(false);
      await load();
      setMsg('Usuario creado');
      setTimeout(() => setMsg(''), 2500);
    } catch (e) {
      setMsg('Error: ' + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function updateUser(id: string, patch: Record<string, unknown>) {
    try {
      await api('/api/panel/usuarios', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...patch }),
      });
      await load();
    } catch (e) {
      setMsg('Error: ' + (e as Error).message);
    }
  }

  async function changePassword(id: string) {
    if (pwVal.trim().length < 6) { setMsg('Mínimo 6 caracteres'); return; }
    await updateUser(id, { password: pwVal.trim() });
    setPwEdit(null);
    setPwVal('');
    setMsg('Contraseña actualizada');
    setTimeout(() => setMsg(''), 2500);
  }

  async function deleteUser(id: string, username: string) {
    if (!confirm(`¿Seguro que querés borrar al usuario "${username}"?`)) return;
    try {
      await api('/api/panel/usuarios', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      await load();
      setMsg('Usuario eliminado');
      setTimeout(() => setMsg(''), 2500);
    } catch (e) {
      setMsg('Error: ' + (e as Error).message);
    }
  }

  const roleLabel = (r: string) => ROLES.find((x) => x.value === r)?.label ?? r;

  return (
    <>
      <div className="page-head" style={{ marginBottom: '1rem' }}>
        <div className="page-head__text">
          <h1>Usuarios del panel</h1>
          <p>Admin gestiona operadores y sus permisos. El admin tiene permisos totales.</p>
        </div>
      </div>

      {msg && <p style={{ color: 'var(--accent)', fontSize: '.85rem', margin: '0 0 .8rem' }}>{msg}</p>}

      {/* Create user form */}
      <section className="card" style={{ marginBottom: '1.2rem' }}>
        <div
          onClick={() => setOpen(!open)}
          style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', userSelect: 'none' }}
        >
          <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--accent-soft)', display: 'grid', placeItems: 'center', color: 'var(--accent)' }}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: '.9rem' }}>Crear usuario</div>
            <div style={{ color: 'var(--muted)', fontSize: '.78rem' }}>Nuevo acceso al panel con rol y permisos</div>
          </div>
          <span style={{ fontSize: '1.2rem', color: 'var(--muted)', transform: open ? 'rotate(180deg)' : '', transition: 'transform .2s' }}>&#9660;</span>
        </div>

        {open && (
          <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '.8rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '.8rem' }}>
              <div className="field" style={{ margin: 0 }}>
                <label style={{ textTransform: 'uppercase', fontSize: '.68rem', fontWeight: 700, letterSpacing: '.04em', color: 'var(--muted)' }}>Usuario</label>
                <input className="input" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="nombre de usuario" />
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label style={{ textTransform: 'uppercase', fontSize: '.68rem', fontWeight: 700, letterSpacing: '.04em', color: 'var(--muted)' }}>Contraseña</label>
                <input className="input" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="mínimo 6 caracteres" />
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label style={{ textTransform: 'uppercase', fontSize: '.68rem', fontWeight: 700, letterSpacing: '.04em', color: 'var(--muted)' }}>Rol</label>
                <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                  {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </div>
            </div>

            <div style={{ fontSize: '.75rem', color: 'var(--muted)', fontWeight: 600 }}>Permisos iniciales</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '.5rem' }}>
              {[
                { label: 'Chats web', roles: ['operador', 'supervisor', 'admin'] },
                { label: 'Cargar / Retirar fichas', roles: ['operador', 'supervisor', 'admin'] },
                { label: 'Reportes', roles: ['supervisor', 'admin'] },
                { label: 'Embudo', roles: ['supervisor', 'admin'] },
                { label: 'Ajustes chat', roles: ['supervisor', 'admin'] },
                { label: 'Configuración', roles: ['admin'] },
                { label: 'Gestionar usuarios', roles: ['admin'] },
              ].map((p) => {
                const has = p.roles.includes(form.role);
                return (
                  <div key={p.label} style={{
                    padding: '.55rem .75rem', borderRadius: 8,
                    border: `1px solid ${has ? 'var(--accent)' : 'var(--border)'}`,
                    background: has ? 'var(--accent-soft)' : 'transparent',
                    fontSize: '.8rem', display: 'flex', alignItems: 'center', gap: 8,
                    color: has ? 'var(--text)' : 'var(--muted)',
                  }}>
                    {has ? (
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="var(--accent)" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                    ) : (
                      <div style={{ width: 16, height: 16, borderRadius: 4, border: '1.5px solid var(--muted)' }} />
                    )}
                    {p.label}
                  </div>
                );
              })}
            </div>

            <div style={{ display: 'flex', gap: '.6rem', alignItems: 'center', marginTop: '.3rem' }}>
              <button className="btn" onClick={create} disabled={busy}>Crear usuario</button>
            </div>
          </div>
        )}
      </section>

      {/* User list */}
      <section className="card">
        <div style={{ fontWeight: 700, fontSize: '.95rem', marginBottom: '.3rem' }}>Existentes</div>
        <div style={{ color: 'var(--muted)', fontSize: '.78rem', marginBottom: '.9rem' }}>{users.length} usuario{users.length !== 1 ? 's' : ''}</div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '.9rem' }}>
          {users.map((u) => (
            <div key={u.id} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '.9rem 1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--accent-soft)', display: 'grid', placeItems: 'center', color: 'var(--accent)' }}>
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                </div>
                <div style={{ flex: 1, minWidth: 120 }}>
                  <span style={{ fontWeight: 600, fontSize: '.9rem' }}>{u.displayName || u.username}</span>
                  {u.displayName && <span style={{ color: 'var(--muted)', fontSize: '.78rem', marginLeft: 6 }}>({u.username})</span>}
                  <span style={{
                    marginLeft: 8, fontSize: '.68rem', padding: '2px 8px', borderRadius: 6,
                    background: u.active ? 'rgba(37, 211, 102, 0.15)' : 'rgba(255,100,100,.15)',
                    color: u.active ? '#25D366' : '#ff6464',
                    fontWeight: 600,
                  }}>{u.active ? 'activo' : 'inactivo'}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '.75rem', color: 'var(--muted)', fontWeight: 600 }}>ROL</span>
                  <select
                    className="input"
                    value={u.role}
                    onChange={(e) => updateUser(u.id, { role: e.target.value })}
                    style={{ width: 130, fontSize: '.82rem' }}
                  >
                    {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                  <button className="btn" style={{ fontSize: '.78rem', padding: '.35rem .7rem' }} onClick={() => updateUser(u.id, { active: !u.active })}>
                    {u.active ? 'Desactivar' : 'Activar'}
                  </button>
                  <button className="btn" style={{ fontSize: '.78rem', padding: '.35rem .7rem' }} onClick={() => { setPwEdit(u.id); setPwVal(''); }}>
                    Contraseña
                  </button>
                  <button className="btn" style={{ fontSize: '.78rem', padding: '.35rem .7rem', color: '#ff6464', borderColor: '#ff6464' }} onClick={() => deleteUser(u.id, u.username)}>
                    Borrar
                  </button>
                </div>
              </div>

              {pwEdit === u.id && (
                <div style={{ marginTop: '.6rem', display: 'flex', gap: '.5rem', alignItems: 'center' }}>
                  <input className="input" type="password" placeholder="nueva contraseña (mín. 6)" value={pwVal} onChange={(e) => setPwVal(e.target.value)} style={{ maxWidth: 240 }} />
                  <button className="btn" onClick={() => changePassword(u.id)}>Guardar</button>
                  <button className="btn" onClick={() => setPwEdit(null)}>Cancelar</button>
                </div>
              )}

              {/* Permission preview */}
              <div style={{ marginTop: '.6rem' }}>
                <div style={{ fontSize: '.7rem', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: '.35rem' }}>Permisos</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '.4rem' }}>
                  {[
                    { label: 'Ver chats', roles: ['operador', 'supervisor', 'admin'] },
                    { label: 'Responder chats', roles: ['operador', 'supervisor', 'admin'] },
                    { label: 'Cargar / Retirar fichas', roles: ['operador', 'supervisor', 'admin'] },
                    { label: 'Reportes', roles: ['supervisor', 'admin'] },
                    { label: 'Embudo', roles: ['supervisor', 'admin'] },
                    { label: 'Ajustes chat', roles: ['supervisor', 'admin'] },
                    { label: 'Configuración', roles: ['admin'] },
                    { label: 'Gestionar usuarios', roles: ['admin'] },
                  ].map((p) => {
                    const has = p.roles.includes(u.role);
                    return (
                      <div key={p.label} style={{
                        padding: '.4rem .6rem', borderRadius: 6,
                        border: `1px solid ${has ? 'var(--accent)' : 'var(--border)'}`,
                        background: has ? 'var(--accent-soft)' : 'transparent',
                        fontSize: '.75rem', display: 'flex', alignItems: 'center', gap: 6,
                        color: has ? 'var(--text)' : 'var(--muted)',
                      }}>
                        {has ? (
                          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="var(--accent)" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                        ) : (
                          <div style={{ width: 14, height: 14, borderRadius: 3, border: '1.5px solid var(--muted)' }} />
                        )}
                        {p.label}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type Item = {
  sessionKey: string;
  phone: string | null;
  name: string | null;
  username: string | null;
  archived: boolean;
  step: string | null;
  kommoLeadId: number | null;
  campaign: string | null;
  waVerified: boolean | null;
  hasComprobante: boolean;
  msgCount: number;
  lastText: string;
  lastFrom: 'bot' | 'user' | null;
  createdAt: string | null;
  updatedAt: string | null;
};

type Msg = { from: 'bot' | 'user'; text?: string; image?: string; at: number; op?: boolean };

// Nombres IGUALES al embudo de Kommo (para que el operario no traduzca).
const STEP: Record<string, { label: string; color: string }> = {
  form: { label: 'Formulario', color: '#64748b' },
  welcome: { label: 'Pidió Usuario', color: '#64748b' },
  credenciales: { label: 'Usuario Creado', color: '#0ea5e9' },
  cbu: { label: 'Pidió CBU', color: '#3b82f6' },
  comprobante: { label: 'Pidió CBU', color: '#3b82f6' },
  app_onboarding: { label: 'Instalando app', color: '#f59e0b' },
  validando: { label: 'Revisar imagen', color: '#f97316' },
  done: { label: 'Cargo$', color: '#22c55e' },
  no_cargo: { label: 'No Cargo', color: '#ef4444' },
  closed: { label: 'Cerrado', color: '#94a3b8' },
};
// Orden del dropdown de estados (mismo que el embudo).
const STEP_ORDER = ['welcome', 'credenciales', 'comprobante', 'app_onboarding', 'validando', 'done', 'no_cargo', 'closed'];

const stepInfo = (s: string | null) => STEP[s ?? ''] ?? { label: s ?? '—', color: '#64748b' };

// Chime suave (Web Audio) — arpegio mayor, ataque lento, sin dependencias.
let _audioCtx: AudioContext | null = null;
function playChime() {
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    _audioCtx = _audioCtx || new AC();
    const ctx = _audioCtx;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const now = ctx.currentTime;
    [523.25, 659.25, 783.99].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      const t = now + i * 0.12;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.18, t + 0.04);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      o.connect(g); g.connect(ctx.destination);
      o.start(t); o.stop(t + 0.55);
    });
  } catch { /* sin audio */ }
}
const fmtTime = (at: number) => {
  const d = new Date(at < 1e12 ? at * 1000 : at); // tolera epoch en segundos
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const hh = d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
  return sameDay ? hh : `${d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })} ${hh}`;
};
const timeAgo = (iso: string | null) => {
  if (!iso) return '';
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'hace un momento';
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  return `hace ${Math.floor(s / 86400)} d`;
};

// Predicado a nivel módulo (para detectar atención nueva en el poll).
const itemNeedsAttention = (i: Item): boolean => {
  if (i.archived) return false;
  const review = (i.step === 'validando' || i.hasComprobante) && i.step !== 'done' && i.step !== 'closed';
  return review || i.lastFrom === 'user';
};

export function ChatsClient() {
  const [items, setItems] = useState<Item[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ messages: Msg[]; phone: string | null; name: string | null; username: string | null; step: string | null; kommoLeadId: number | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [custom, setCustom] = useState('');
  const [filter, setFilter] = useState<'todos' | 'revisar' | 'no_leidos' | 'activos' | 'acreditados' | 'no_cargo' | 'archivadas'>('todos');
  const [q, setQ] = useState('');
  const [kpiRange, setKpiRange] = useState<'hoy' | 'ayer' | 'siempre'>('hoy');
  const [stats, setStats] = useState<Array<{ step: string | null; createdAt: string | null }>>([]);
  const [soundOn, setSoundOn] = useState(true);
  const soundRef = useRef(true);
  const prevAttn = useRef<Set<string> | null>(null);
  useEffect(() => {
    const v = (() => { try { return localStorage.getItem('chatSoundOn') !== '0'; } catch { return true; } })();
    setSoundOn(v); soundRef.current = v;
  }, []);
  function toggleSound() {
    const next = !soundOn;
    setSoundOn(next); soundRef.current = next;
    try { localStorage.setItem('chatSoundOn', next ? '1' : '0'); } catch { /* ignore */ }
    if (next) { playChime(); if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {}); }
  }
  const [toast, setToast] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  const loadList = useCallback(async () => {
    const r = await fetch('/api/panel/chats').then((x) => x.json()).catch(() => null);
    if (!r?.ok) return;
    const its: Item[] = r.items;
    // Notificar SOLO cuando aparece una atención NUEVA (no en cada refresh).
    const attnNow = new Set(its.filter(itemNeedsAttention).map((i) => i.sessionKey));
    if (prevAttn.current && soundRef.current) {
      let nuevo = 0;
      attnNow.forEach((k) => { if (!prevAttn.current!.has(k)) nuevo++; });
      if (nuevo > 0) {
        playChime();
        if ('Notification' in window && Notification.permission === 'granted') {
          try { new Notification('TrackerIO · Chats', { body: `${nuevo} chat${nuevo > 1 ? 's' : ''} requiere${nuevo > 1 ? 'n' : ''} atención` }); } catch { /* sin permiso */ }
        }
      }
    }
    prevAttn.current = attnNow;
    setItems(its);
    setStats(r.stats ?? []);
  }, []);

  const loadDetail = useCallback(async (key: string) => {
    const r = await fetch('/api/panel/chats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionKey: key, op: 'get' }),
    }).then((x) => x.json()).catch(() => null);
    if (r?.ok) {
      const s = r.session;
      setDetail({ messages: (s.messages ?? []) as Msg[], phone: s.phone, name: s.name, username: (s.data?.username as string) ?? null, step: s.step, kommoLeadId: s.kommoLeadId });
    }
  }, []);

  useEffect(() => { loadList(); const t = setInterval(loadList, 8000); return () => clearInterval(t); }, [loadList]);
  useEffect(() => { if (sel) loadDetail(sel); }, [sel, loadDetail]);
  useEffect(() => {
    if (!sel) return;
    const t = setInterval(() => loadDetail(sel), 6000);
    return () => clearInterval(t);
  }, [sel, loadDetail]);
  useEffect(() => { if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight; }, [detail]);

  async function exportDone() {
    const r = await fetch('/api/panel/chats', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'export_done' }),
    }).then((x) => x.json()).catch(() => null);
    if (!r?.ok || !r.rows?.length) { setToast('No hay acreditados para exportar'); setTimeout(() => setToast(null), 2000); return; }
    const cols = ['nombre', 'usuario', 'telefono', 'campana', 'acreditado', 'kommo'];
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [cols.join(','), ...r.rows.map((row: Record<string, unknown>) => cols.map((c) => esc(row[c])).join(','))].join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `acreditados-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setToast(`Exportados ${r.rows.length} acreditados ✓`);
    setTimeout(() => setToast(null), 2200);
  }

  async function act(op: string, text?: string, step?: string) {
    if (!sel || busy) return;
    setBusy(true);
    const r = await fetch('/api/panel/chats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionKey: sel, op, text, step }),
    }).then((x) => x.json()).catch(() => null);
    setBusy(false);
    if (r?.ok) {
      setToast('Enviado al chat ✓');
      setTimeout(() => setToast(null), 1800);
      await loadDetail(sel);
      await loadList();
    } else {
      setToast(r?.error ?? 'Error');
      setTimeout(() => setToast(null), 2500);
    }
  }

  // "Revisar" = necesita acción del operador sobre una imagen: mandó comprobante
  // (o está en validando) y todavía NO está acreditado/cerrado. Así no se cuentan
  // los ya resueltos que conservan la imagen en el historial.
  const needsReview = (i: Item) => !i.archived && (i.step === 'validando' || i.hasComprobante) && i.step !== 'done' && i.step !== 'closed';
  const noLeido = (i: Item) => !i.archived && i.lastFrom === 'user';
  // "Requiere atención" = comprobante por revisar O cliente esperando respuesta.
  const needsAttention = (i: Item) => needsReview(i) || noLeido(i);
  const ql = q.trim().toLowerCase();
  const shown = items.filter((i) => {
    if (ql) {
      const hay = `${i.name ?? ''} ${i.username ?? ''} ${i.phone ?? ''} ${i.campaign ?? ''}`.toLowerCase();
      if (!hay.includes(ql)) return false;
    }
    if (filter === 'archivadas') return i.archived;
    if (i.archived) return false; // el resto de tabs oculta archivados
    if (filter === 'revisar') return needsReview(i);
    if (filter === 'no_leidos') return noLeido(i);
    if (filter === 'activos') return i.step !== 'done' && i.step !== 'closed' && i.step !== 'no_cargo';
    if (filter === 'acreditados') return i.step === 'done';
    if (filter === 'no_cargo') return i.step === 'no_cargo';
    return true;
  });

  const counts = {
    atencion: items.filter(needsAttention).length,
    revisar: items.filter(needsReview).length,
    noLeidos: items.filter(noLeido).length,
    activos: items.filter((i) => !i.archived && i.step !== 'done' && i.step !== 'closed' && i.step !== 'no_cargo').length,
    acreditados: items.filter((i) => !i.archived && i.step === 'done').length,
    no_cargo: items.filter((i) => !i.archived && i.step === 'no_cargo').length,
    archivadas: items.filter((i) => i.archived).length,
  };

  // KPIs por rango de fecha (creación). Conversión = acreditados / chats del rango.
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const yStart = new Date(today); yStart.setDate(yStart.getDate() - 1);
  const inRange = (iso: string | null) => {
    if (kpiRange === 'siempre') return true;
    if (!iso) return false;
    const d = new Date(iso);
    if (kpiRange === 'hoy') return d >= today;
    return d >= yStart && d < today; // ayer
  };
  // KPIs sobre TODA la base (stats), no solo los 200 de la lista.
  const rangeStats = stats.filter((i) => inRange(i.createdAt));
  const doneRange = rangeStats.filter((i) => i.step === 'done').length;
  const kpis = {
    chats: rangeStats.length,
    esperando: stats.filter((i) => i.step === 'comprobante' || i.step === 'cbu').length,
    revisar: stats.filter((i) => i.step === 'validando').length,
    acreditados: doneRange,
    conv: rangeStats.length ? Math.round((100 * doneRange) / rangeStats.length) : 0,
    sinLeer: items.filter((i) => i.lastFrom === 'user').length, // sin-leer: solo recientes (necesita mensajes)
  };
  const KPI = ({ label, value, color }: { label: string; value: string | number; color?: string }) => (
    <div style={{ flex: '1 1 0', minWidth: 90, padding: '.55rem .7rem', border: '1px solid var(--border)', borderRadius: 12, background: 'var(--card, rgba(255,255,255,.02))' }}>
      <div style={{ fontSize: '1.25rem', fontWeight: 800, color: color ?? 'var(--text)', lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: '.7rem', color: 'var(--muted,#94a3b8)', marginTop: '.25rem', textTransform: 'uppercase', letterSpacing: '.02em' }}>{label}</div>
    </div>
  );

  return (
    <>
    <div style={{ display: 'flex', gap: '.4rem', marginBottom: '.6rem', alignItems: 'center' }}>
      {([['hoy', 'Hoy'], ['ayer', 'Ayer'], ['siempre', 'Desde siempre']] as const).map(([r, label]) => (
        <button key={r} onClick={() => setKpiRange(r)} className={`btn ${kpiRange === r ? '' : 'btn--ghost'}`} style={{ padding: '.3rem .8rem', fontSize: '.8rem' }}>{label}</button>
      ))}
      <div style={{ marginLeft: 'auto', display: 'flex', gap: '.4rem', alignItems: 'center' }}>
        {counts.atencion > 0 && (
          <button onClick={() => setFilter('no_leidos')} className="btn" style={{ padding: '.3rem .8rem', fontSize: '.8rem', background: '#f59e0b', borderColor: '#f59e0b', color: '#1b1200' }}
            title="Chats que requieren atención (comprobante por revisar o cliente esperando)">⚠️ Atención ({counts.atencion})</button>
        )}
        <button onClick={toggleSound} className={`btn ${soundOn ? '' : 'btn--ghost'}`} style={{ padding: '.3rem .6rem', fontSize: '.9rem' }}
          title={soundOn ? 'Sonido de atención: activado' : 'Sonido de atención: apagado'}>{soundOn ? '🔔' : '🔕'}</button>
        <button onClick={exportDone} className="btn" style={{ padding: '.3rem .8rem', fontSize: '.8rem', background: '#16a34a', borderColor: '#16a34a' }}
          title="Descargar CSV con usuario + teléfono de los acreditados (para cruzar con la base de cargas)">⬇ Descargar acreditados</button>
      </div>
    </div>
    <div style={{ display: 'flex', gap: '.6rem', marginBottom: '.8rem', flexWrap: 'wrap' }}>
      <KPI label={`Chats ${kpiRange === 'siempre' ? 'total' : kpiRange}`} value={kpis.chats} />
      <KPI label="Esperando pago" value={kpis.esperando} color="#3b82f6" />
      <KPI label="Revisar imagen" value={kpis.revisar} color="#f97316" />
      <KPI label={`Acreditados ${kpiRange === 'siempre' ? 'total' : kpiRange}`} value={kpis.acreditados} color="#22c55e" />
      <KPI label={`Conversión ${kpiRange === 'siempre' ? '' : kpiRange}`.trim()} value={`${kpis.conv}%`} color="var(--accent, #7c5cff)" />
      <KPI label="Sin leer" value={kpis.sinLeer} color={kpis.sinLeer ? '#22c55e' : undefined} />
    </div>
    <div style={{ display: 'grid', gridTemplateColumns: '400px minmax(0,1fr)', gap: '1rem', alignItems: 'stretch', height: 'calc(100vh - 210px)', minHeight: 560 }}>
      {/* LISTA */}
      <div className="card" style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div style={{ padding: '.7rem .7rem .3rem', flexShrink: 0 }}>
          <input className="input" placeholder="🔍 Buscar por nombre, usuario, teléfono o campaña…" value={q}
            onChange={(e) => setQ(e.target.value)} style={{ width: '100%', fontSize: '.85rem' }} />
        </div>
        <div style={{ display: 'flex', gap: '.35rem', padding: '.3rem .7rem .7rem', borderBottom: '1px solid var(--border)', flexShrink: 0, flexWrap: 'wrap' }}>
          {([
            ['todos', 'Todos', null],
            ['no_leidos', `📨 No leídos`, counts.noLeidos],
            ['revisar', `🔎 Revisar`, counts.revisar],
            ['activos', `Activos`, counts.activos],
            ['acreditados', `✅ Acreditados`, counts.acreditados],
            ['no_cargo', `🚫 No cargó`, counts.no_cargo],
            ['archivadas', `🗂 Archivadas`, counts.archivadas],
          ] as const).map(([f, label, n]) => (
            <button key={f} onClick={() => setFilter(f)}
              className={`btn ${filter === f ? '' : 'btn--ghost'}`}
              style={{ padding: '.32rem .6rem', fontSize: '.78rem' }}>
              {label}{n ? ` (${n})` : ''}
            </button>
          ))}
        </div>
        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
          {shown.length === 0 && <div className="empty" style={{ padding: '2rem' }}>Sin chats.</div>}
          {shown.map((i) => {
            const si = stepInfo(i.step);
            return (
              <button key={i.sessionKey} onClick={() => setSel(i.sessionKey)}
                style={{
                  display: 'block', width: '100%', textAlign: 'left', padding: '.7rem .85rem',
                  border: 'none', borderBottom: '1px solid var(--border)', cursor: 'pointer',
                  background: sel === i.sessionKey ? 'var(--bg-2, rgba(120,120,120,.12))' : 'transparent',
                }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.5rem' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '.4rem', minWidth: 0 }}>
                    {i.lastFrom === 'user' && <span title="Mensaje nuevo del cliente" style={{ width: 8, height: 8, borderRadius: '50%', background: '#22c55e', flexShrink: 0, boxShadow: '0 0 0 2px rgba(34,197,94,.25)' }} />}
                    <strong style={{ fontSize: '.92rem', fontWeight: i.lastFrom === 'user' ? 800 : 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{i.name || i.phone || 'Sin nombre'}</strong>
                  </span>
                  <span style={{ fontSize: '.7rem', color: 'var(--muted, #94a3b8)', flexShrink: 0 }}>{timeAgo(i.updatedAt)}</span>
                </div>
                <div style={{ display: 'flex', gap: '.4rem', alignItems: 'center', margin: '.3rem 0' }}>
                  <span style={{ fontSize: '.68rem', fontWeight: 700, color: '#fff', background: si.color, padding: '.1rem .45rem', borderRadius: 20 }}>{si.label}</span>
                  {i.hasComprobante && i.step !== 'done' && i.step !== 'closed' && (
                    <span title="Envió comprobante — requiere revisión" style={{ fontSize: '.66rem', fontWeight: 700, color: '#fff', background: '#16a34a', padding: '.1rem .45rem', borderRadius: 20 }}>🧾 Comprobante</span>
                  )}
                  {i.username && <span title="Usuario del portal" style={{ fontSize: '.68rem', fontWeight: 700, color: 'var(--accent,#7c5cff)' }}>@{i.username}</span>}
                  {i.campaign && <span style={{ fontSize: '.68rem', color: 'var(--muted,#94a3b8)' }}>{i.campaign}</span>}
                </div>
                <div style={{ fontSize: '.78rem', color: 'var(--muted,#94a3b8)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {i.lastFrom === 'user' ? '👤 ' : ''}{i.lastText}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* DETALLE */}
      <div className="card" style={{ padding: 0, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
        {!detail ? (
          <div className="empty" style={{ padding: '3rem', margin: 'auto' }}>Elegí un chat para ver la conversación.</div>
        ) : (
          <>
            <div style={{ padding: '.8rem 1rem', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
              {/* IZQUIERDA: nombre + selector de estado pegado */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', minWidth: 0 }}>
                <strong style={{ fontSize: '1.05rem', whiteSpace: 'nowrap' }}>{detail.name || detail.phone}</strong>
                {detail.username && <span title="Usuario del portal" style={{ fontSize: '.78rem', fontWeight: 700, color: 'var(--accent,#7c5cff)', whiteSpace: 'nowrap' }}>@{detail.username}</span>}
                <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }} title="Cambiar estado">
                  <select
                    value={detail.step ?? ''}
                    disabled={busy}
                    onChange={(e) => act('set_step', undefined, e.target.value)}
                    style={{ background: stepInfo(detail.step).color, color: '#fff', fontWeight: 700, fontSize: '.75rem', border: 'none', borderRadius: 8, padding: '.3rem 1.8rem .3rem .65rem', cursor: 'pointer', appearance: 'none', WebkitAppearance: 'none', MozAppearance: 'none' }}>
                    {STEP_ORDER.map((st) => (
                      <option key={st} value={st} style={{ background: '#1b1f28', color: '#fff' }}>{STEP[st].label}</option>
                    ))}
                  </select>
                  <span aria-hidden style={{ position: 'absolute', right: '.55rem', color: '#fff', fontSize: '.62rem', pointerEvents: 'none' }}>▼</span>
                </div>
              </div>
              {/* DERECHA: contacto */}
              <div style={{ fontSize: '.76rem', color: 'var(--muted,#94a3b8)', display: 'flex', alignItems: 'center', gap: '.4rem', flexWrap: 'wrap' }}>
                <span>📞 {detail.phone || '—'}</span>
                {detail.phone && (
                  <button onClick={() => { navigator.clipboard?.writeText(detail.phone!).then(() => { setToast('Teléfono copiado ✓'); setTimeout(() => setToast(null), 1500); }); }}
                    title="Copiar teléfono" style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', color: 'var(--muted,#94a3b8)', fontSize: '.7rem', padding: '.05rem .35rem' }}>⧉ copiar</button>
                )}
                <span>{detail.kommoLeadId ? `· Kommo #${detail.kommoLeadId}` : '· sin lead Kommo'}</span>
              </div>
            </div>

            <div ref={bodyRef} style={{ flex: 1, overflowY: 'auto', padding: '1.1rem 1.2rem', display: 'flex', flexDirection: 'column', gap: '.7rem', minHeight: 0, background: 'var(--bg, rgba(0,0,0,.18))' }}>
              {detail.messages.map((m, idx) => {
                // Vista de operador: el LEAD (cliente) va a la izquierda, NOSOTROS
                // (bot/operador) a la derecha — estilo Black Dragon.
                const mine = m.from === 'bot';
                // Distinguimos automático (BOT) de lo enviado por el operador desde el panel.
                const who = mine ? (m.op ? 'Operador' : 'Bot') : (detail.name || detail.phone || 'Cliente');
                const accent = mine && m.op ? 'var(--accent, #7c5cff)' : mine ? '#8b93a3' : 'var(--muted,#8b93a3)';
                return (
                  <div key={idx} style={{ display: 'flex', flexDirection: 'column', alignItems: mine ? 'flex-end' : 'flex-start', maxWidth: '74%', alignSelf: mine ? 'flex-end' : 'flex-start' }}>
                    <div style={{ fontSize: '.66rem', fontWeight: 700, letterSpacing: '.02em', color: mine ? accent : 'var(--muted,#8b93a3)', margin: mine ? '0 .35rem .18rem 0' : '0 0 .18rem .35rem', textTransform: 'uppercase' }}>
                      {who} · {fmtTime(m.at)}
                    </div>
                    <div style={{
                      padding: m.image ? '.4rem' : '.6rem .8rem', borderRadius: 16, fontSize: '.9rem', lineHeight: 1.45, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                      boxShadow: '0 2px 6px rgba(0,0,0,.22)',
                      background: mine ? 'var(--card-2, #232834)' : 'var(--card-3, #1b1f28)',
                      color: 'var(--text)',
                      border: mine ? `1px solid color-mix(in srgb, ${accent} 45%, transparent)` : '1px solid var(--border)',
                      borderBottomRightRadius: mine ? 4 : 16,
                      borderBottomLeftRadius: mine ? 16 : 4,
                    }}>
                      {m.image ? <a href={m.image} target="_blank" rel="noreferrer" title="Abrir imagen completa"><img src={m.image} alt="comprobante" style={{ maxWidth: 150, maxHeight: 150, borderRadius: 10, display: 'block', objectFit: 'cover', cursor: 'zoom-in' }} /></a> : m.text}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* ACCIONES */}
            <div style={{ borderTop: '1px solid var(--border)', padding: '.85rem 1rem', display: 'flex', flexDirection: 'column', gap: '.55rem', background: 'var(--card, rgba(255,255,255,.02))', flexShrink: 0 }}>
              <div style={{ fontSize: '.7rem', fontWeight: 700, color: 'var(--muted,#94a3b8)', textTransform: 'uppercase', letterSpacing: '.03em' }}>Comprobante</div>
              <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap' }}>
                <button disabled={busy} onClick={() => act('approve')} className="btn" style={{ background: '#22c55e', borderColor: '#22c55e' }}>✅ Aprobar</button>
                <button disabled={busy} onClick={() => act('pending')} className="btn btn--ghost">⏳ Pendiente</button>
                <button disabled={busy} onClick={() => act('reject')} className="btn btn--ghost" style={{ color: '#ef4444' }}>⚠️ Erróneo</button>
                <button disabled={busy} onClick={() => act('set_step', undefined, 'no_cargo')} className="btn btn--ghost" style={{ color: '#ef4444', borderColor: '#ef4444' }}>🚫 No cargó</button>
              </div>
              <div style={{ fontSize: '.7rem', fontWeight: 700, color: 'var(--muted,#94a3b8)', textTransform: 'uppercase', letterSpacing: '.03em', marginTop: '.2rem' }}>Entregar en el chat</div>
              <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap' }}>
                <button disabled={busy} onClick={() => act('support')} className="btn btn--ghost">🙋 Soporte (walink)</button>
                <button disabled={busy} onClick={() => act('deposit')} className="btn btn--ghost">💰 Cargar</button>
                <button disabled={busy} onClick={() => act('withdraw')} className="btn btn--ghost">💸 Retirar</button>
                <button disabled={busy} onClick={() => act('forgot_user')} className="btn btn--ghost">🔐 Reenviar datos</button>
              </div>
              <div style={{ display: 'flex', gap: '.4rem', marginTop: '.2rem', alignItems: 'center' }}>
                {(() => {
                  const cur = items.find((i) => i.sessionKey === sel);
                  const isArch = cur?.archived;
                  return (
                    <button disabled={busy} onClick={() => act(isArch ? 'unarchive' : 'archive')} className="btn btn--ghost" style={{ fontSize: '.82rem' }}
                      title={isArch ? 'Desarchivar' : 'Archivar (se reabre solo si el cliente escribe)'}>{isArch ? '📤 Desarchivar' : '🗂 Archivar'}</button>
                  );
                })()}
              </div>
              <div style={{ display: 'flex', gap: '.4rem', marginTop: '.2rem' }}>
                <input className="input" placeholder="Mensaje libre al cliente…" value={custom}
                  onChange={(e) => setCustom(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && custom.trim()) { act('custom', custom); setCustom(''); } }}
                  style={{ flex: 1 }} />
                <button disabled={busy || !custom.trim()} onClick={() => { act('custom', custom); setCustom(''); }} className="btn">Enviar</button>
              </div>
            </div>
          </>
        )}
      </div>

      {toast && (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: '#111827', color: '#fff', padding: '.6rem 1rem', borderRadius: 10, fontSize: '.85rem', zIndex: 50 }}>{toast}</div>
      )}
    </div>
    </>
  );
}

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type Item = {
  sessionKey: string;
  phone: string | null;
  name: string | null;
  username: string | null;
  archived: boolean;
  unread: boolean;
  blocked: boolean;
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

// Un chat está "activo" en la bandeja (no archivado, no terminal).
const isActive = (i: Item): boolean => !i.archived && i.step !== 'done' && i.step !== 'no_cargo' && i.step !== 'closed';
// Abierto al trabajo del operador (ignora archivado — puede estar archivado por
// antigüedad pero con comprobante o mensaje sin leer).
const isOpen = (i: Item): boolean => !i.blocked && i.step !== 'done' && i.step !== 'no_cargo' && i.step !== 'closed';
// "Activos" (bandeja) = activo Y con actividad en los últimos 30 min. Si pasa ese
// tiempo sin movimiento, sale de Activos (sigue en su etapa / Todos).
const within30 = (iso: string | null): boolean => !!iso && (Date.now() - new Date(iso).getTime()) <= 30 * 60000;
const isActivoReciente = (i: Item): boolean => isActive(i) && within30(i.updatedAt);
// Predicado a nivel módulo (para detectar atención nueva en el poll).
const itemNeedsAttention = (i: Item): boolean => {
  if (!isOpen(i)) return false;
  return i.step === 'validando' || i.hasComprobante || i.unread;
};

const EXPORT_STEPS = ['welcome', 'credenciales', 'comprobante', 'app_onboarding', 'validando', 'done', 'no_cargo', 'closed'] as const;

function isoDateLocal(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function ChatsClient() {
  const [showKpis, setShowKpis] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ messages: Msg[]; phone: string | null; name: string | null; username: string | null; step: string | null; kommoLeadId: number | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [custom, setCustom] = useState('');
  const [filter, setFilter] = useState<'todos' | 'revisar' | 'no_leidos' | 'activos' | 'acreditados' | 'no_cargo' | 'archivadas'>('todos');
  const [q, setQ] = useState('');
  const [kpiRange, setKpiRange] = useState<'hoy' | 'ayer' | 'siempre'>('hoy');
  const [exportOpen, setExportOpen] = useState(false);
  const [exportFrom, setExportFrom] = useState('');
  const [exportTo, setExportTo] = useState('');
  const [exportSteps, setExportSteps] = useState<string[]>([]);
  const [exportBusy, setExportBusy] = useState(false);
  const [stats, setStats] = useState<Array<{ step: string | null; createdAt: string | null }>>([]);
  // Ancho de la lista (barra divisora arrastrable, estilo Black Dragon).
  const [listW, setListW] = useState(380);
  const listWRef = useRef(380);
  const gridRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const v = Number((() => { try { return localStorage.getItem('chatListW') || ''; } catch { return ''; } })());
    if (v >= 280 && v <= 600) { setListW(v); listWRef.current = v; }
  }, []);
  function startDrag(e: React.MouseEvent) {
    e.preventDefault();
    const move = (ev: MouseEvent) => {
      const rect = gridRef.current?.getBoundingClientRect();
      if (!rect) return;
      const w = Math.max(280, Math.min(600, ev.clientX - rect.left));
      listWRef.current = w; setListW(w);
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      document.body.style.userSelect = '';
      try { localStorage.setItem('chatListW', String(listWRef.current)); } catch { /* ignore */ }
    };
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  }
  function resetDrag() { setListW(380); listWRef.current = 380; try { localStorage.setItem('chatListW', '380'); } catch { /* ignore */ } }
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
  // Autoscroll SOLO si el operador ya está al fondo (o abrió otro chat). Si está
  // leyendo hacia arriba, el poll no lo debe arrastrar hacia abajo.
  const atBottomRef = useRef(true);
  const scrollSelRef = useRef<string | null>(null);
  const scrollCountRef = useRef(0);
  // Forzar bajada SOLO cuando el operador manda algo (no cuando entra un mensaje
  // por el poll: ahí no queremos mover al que está leyendo).
  const forceScrollRef = useRef(false);

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

  // Pestañas terminales (Acreditados / No cargó / Archivadas): son estados viejos
  // que quedan fuera de las 200 recientes, así que se piden aparte al server.
  const [termItems, setTermItems] = useState<Item[]>([]);
  const termView = filter === 'acreditados' ? 'done' : filter === 'no_cargo' ? 'no_cargo' : filter === 'archivadas' ? 'archived' : '';
  const loadTerm = useCallback(async (view: string) => {
    if (!view) return;
    const r = await fetch(`/api/panel/chats?view=${view}`).then((x) => x.json()).catch(() => null);
    if (!r?.ok) return;
    setTermItems(r.items as Item[]);
  }, []);
  useEffect(() => {
    if (!termView) { setTermItems([]); return; }
    loadTerm(termView);
    const t = setInterval(() => loadTerm(termView), 8000);
    return () => clearInterval(t);
  }, [termView, loadTerm]);

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
  // Si llegamos desde el Embudo con ?s=<sessionKey>, abrimos ese chat.
  useEffect(() => {
    try {
      const s = new URL(window.location.href).searchParams.get('s');
      if (s) setSel(s);
    } catch { /* ignore */ }
  }, []);
  useEffect(() => { if (sel) loadDetail(sel); }, [sel, loadDetail]);
  useEffect(() => {
    if (!sel) return;
    const t = setInterval(() => loadDetail(sel), 6000);
    return () => clearInterval(t);
  }, [sel, loadDetail]);
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const count = detail?.messages.length ?? 0;
    const changedChat = scrollSelRef.current !== sel;
    scrollSelRef.current = sel;
    scrollCountRef.current = count;
    // Baja al fondo SOLO al abrir otro chat o cuando el operador acaba de enviar.
    // Los mensajes que llegan por el poll NO mueven el scroll.
    if (changedChat || forceScrollRef.current) {
      el.scrollTop = el.scrollHeight;
      atBottomRef.current = true;
      forceScrollRef.current = false;
    }
  }, [detail, sel]);

  function openExport() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (kpiRange === 'hoy') {
      setExportFrom(isoDateLocal(today));
      setExportTo(isoDateLocal(today));
    } else if (kpiRange === 'ayer') {
      const y = new Date(today);
      y.setDate(y.getDate() - 1);
      setExportFrom(isoDateLocal(y));
      setExportTo(isoDateLocal(y));
    } else {
      setExportFrom('');
      setExportTo('');
    }
    setExportSteps([]);
    setExportOpen(true);
  }

  async function runExport() {
    if (exportBusy) return;
    setExportBusy(true);
    const body: { op: string; from?: string; to?: string; steps?: string[] } = { op: 'export_csv' };
    if (exportFrom) body.from = exportFrom;
    if (exportTo) body.to = exportTo;
    if (exportSteps.length) body.steps = exportSteps;
    const r = await fetch('/api/panel/chats', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then((x) => x.json()).catch(() => null);
    setExportBusy(false);
    if (!r?.ok || !r.rows?.length) {
      setToast('No hay registros con esos filtros');
      setTimeout(() => setToast(null), 2200);
      return;
    }
    const cols = ['nombre', 'usuario', 'telefono', 'estado', 'campana', 'ccpp', 'creado', 'actualizado', 'kommo'];
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [cols.join(','), ...r.rows.map((row: Record<string, unknown>) => cols.map((c) => esc(row[c])).join(','))].join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const tag = exportFrom && exportTo ? `${exportFrom}_${exportTo}` : 'completo';
    a.download = `chats-${tag}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setExportOpen(false);
    const trunc = r.truncated ? ' (límite 10k)' : '';
    setToast(`Exportados ${r.rows.length} registros ✓${trunc}`);
    setTimeout(() => setToast(null), 2800);
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
      forceScrollRef.current = true; // el operador envió → mostramos el fondo
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
  const needsReview = (i: Item) => isOpen(i) && (i.step === 'validando' || i.hasComprobante);
  // Un mensaje nuevo debe marcarse como "no leído" sin importar en qué estado estaba (ej. No Cargo)
  const noLeido = (i: Item) => i.unread;
  // "Requiere atención" = comprobante por revisar O mensaje sin leer (solo activos).
  const needsAttention = (i: Item) => needsReview(i) || noLeido(i);
  const ql = q.trim().toLowerCase();
  // En pestañas terminales la fuente es la lista dedicada del server (no las 200
  // recientes), así que no quedan vacías aunque el estado sea viejo.
  const source = termView ? termItems : items;
  const shown = source.filter((i) => {
    if (ql) {
      const hay = `${i.name ?? ''} ${i.username ?? ''} ${i.phone ?? ''} ${i.campaign ?? ''}`.toLowerCase();
      if (!hay.includes(ql)) return false;
    }
    if (filter === 'archivadas') return i.archived;
    // Pestañas terminales (report/export): muestran TODO el estado, archivado o no,
    // para que la lista coincida con el contador (calculado sobre toda la base).
    if (filter === 'acreditados') return i.step === 'done';
    if (filter === 'no_cargo') return i.step === 'no_cargo';
    // Revisar / No leídos: incluyen archivados auto (comprobante o mensaje pendiente).
    if (filter === 'revisar') return needsReview(i);
    if (filter === 'no_leidos') return noLeido(i);
    if (filter === 'activos') return isActivoReciente(i);
    if (i.archived) return false; // Todos y Activos ocultan archivados
    return true;
  });

  const counts = {
    atencion: items.filter(needsAttention).length,
    revisar: items.filter(needsReview).length,
    noLeidos: items.filter(noLeido).length,
    activos: items.filter(isActivoReciente).length,
    // Acreditados / No cargó: de la BASE COMPLETA (stats) para que coincidan con Kommo.
    acreditados: stats.filter((s) => s.step === 'done').length,
    no_cargo: stats.filter((s) => s.step === 'no_cargo').length,
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
    sinLeer: items.filter((i) => isOpen(i) && i.unread).length,
  };
  // Botón de acción plano (sin brillo violeta). filled = sólido de color.
  const abtn = (color?: string, filled?: boolean): React.CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', gap: '.3rem',
    padding: '.42rem .7rem', fontSize: '.8rem', fontWeight: 600, borderRadius: 8, cursor: 'pointer',
    border: `1px solid ${filled ? (color || 'var(--accent)') : 'var(--border)'}`,
    background: filled ? (color || 'var(--accent)') : 'transparent',
    color: filled ? '#fff' : (color || 'var(--text)'),
    whiteSpace: 'nowrap',
  });

  const KPI = ({ label, value, color }: { label: string; value: string | number; color?: string }) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
      <div style={{ fontSize: '.7rem', color: 'var(--muted)', fontWeight: 500, whiteSpace: 'nowrap' }}>{label}</div>
      <div style={{ fontSize: '1.15rem', fontWeight: 700, color: color ?? 'var(--text)', letterSpacing: '-0.02em', lineHeight: 1.1 }}>{value}</div>
    </div>
  );

  const rangeText = kpiRange === 'siempre' ? 'total' : kpiRange;

  return (
    <>
    <div style={{ display: 'flex', gap: '1rem', marginBottom: '.6rem', alignItems: 'center' }}>
      <button 
        onClick={() => setShowKpis(!showKpis)}
        className="btn"
        style={{ padding: '.3rem .6rem', fontSize: '.78rem', display: 'flex', gap: '.4rem', alignItems: 'center', background: 'transparent', border: '1px solid var(--border)', color: 'var(--text)', boxShadow: 'none' }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: showKpis ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
        Métricas
      </button>

      {/* 4. Acciones alineadas a la derecha arriba de todo */}
      <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', marginLeft: 'auto' }}>
        {counts.atencion > 0 && (
          <button onClick={() => setFilter('revisar')}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '.35rem', padding: '.3rem .6rem', fontSize: '.76rem', fontWeight: 700, border: '1px solid #e8883855', borderRadius: 8, background: '#e888381a', color: '#e8a050', cursor: 'pointer', transition: 'all .2s' }}
            title="Chats que requieren atención (comprobante por revisar o cliente esperando)">
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#e88838', boxShadow: '0 0 6px #e88838' }} /> Atención · {counts.atencion}
          </button>
        )}
        <button onClick={toggleSound} aria-label="Sonido de atención"
          style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, borderRadius: 8, border: '1px solid var(--border)', background: soundOn ? 'var(--accent-soft)' : 'transparent', color: soundOn ? 'var(--accent)' : 'var(--muted)', cursor: 'pointer', transition: 'all .2s' }}
          title={soundOn ? 'Sonido de atención: activado' : 'Sonido de atención: apagado'}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" />
            {!soundOn && <line x1="3" y1="3" x2="21" y2="21" />}
          </svg>
        </button>
        <button onClick={openExport}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '.4rem', padding: '.3rem .6rem', fontSize: '.76rem', fontWeight: 600, border: '1px solid rgba(52,210,122,0.3)', borderRadius: 8, background: 'rgba(52,210,122,0.1)', color: 'var(--success)', cursor: 'pointer', transition: 'all .2s' }}
          title="Exportar CSV: rango de fechas, filtro por estado, usuario y teléfono separados">⬇ Exportar</button>
      </div>
    </div>

    {showKpis && (
      <div style={{ display: 'flex', gap: '1.25rem', marginBottom: '1rem', alignItems: 'center', flexWrap: 'wrap', background: 'var(--bg-2)', padding: '.65rem .85rem', borderRadius: 10, border: '1px solid var(--border)', boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.02)' }}>
        {/* 1. Selector de fechas (Segmented Control) */}
        <div style={{ display: 'flex', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: 2, gap: 2 }}>
          {([['hoy', 'Hoy'], ['ayer', 'Ayer'], ['siempre', 'Histórico']] as const).map(([r, label]) => {
            const active = kpiRange === r;
            return (
              <button key={r} onClick={() => setKpiRange(r)}
                style={{
                  border: 'none', background: active ? 'var(--card)' : 'transparent',
                  color: active ? 'var(--text)' : 'var(--muted)',
                  fontWeight: active ? 600 : 500,
                  padding: '.25rem .6rem', fontSize: '.74rem', borderRadius: 4,
                  cursor: 'pointer', transition: 'all .2s',
                  boxShadow: active ? '0 1px 4px rgba(0,0,0,0.15)' : 'none'
                }}>
                {label}
              </button>
            );
          })}
        </div>

        <div style={{ width: 1, height: 24, background: 'var(--border)' }} />

        {/* 2. Métricas del rango seleccionado */}
        <div style={{ display: 'flex', gap: '1.25rem', alignItems: 'center' }}>
          <KPI label={`Chats ${rangeText}`} value={kpis.chats} />
          <KPI label={`Acreditados ${rangeText}`} value={kpis.acreditados} color="var(--success)" />
          <KPI label={`Conversión ${rangeText}`} value={`${kpis.conv}%`} color="var(--accent)" />
        </div>

        <div style={{ width: 1, height: 24, background: 'var(--border)' }} />

        {/* 3. Colas en tiempo real */}
        <div style={{ display: 'flex', gap: '1.25rem', alignItems: 'center' }}>
          <KPI label="Esperando pago" value={kpis.esperando} color="var(--blue)" />
          <KPI label="Revisar imagen" value={kpis.revisar} color="var(--warn)" />
          <KPI label="Sin leer" value={kpis.sinLeer} color={kpis.sinLeer ? 'var(--success)' : undefined} />
        </div>
      </div>
    )}

    <div ref={gridRef} style={{ display: 'grid', gridTemplateColumns: `${listW}px 10px minmax(0,1fr)`, alignItems: 'stretch', height: `calc(100vh - ${showKpis ? '150px' : '90px'})`, minHeight: 560 }}>
      {/* LISTA */}
      <div className="card" style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div style={{ padding: '.6rem .6rem .35rem', flexShrink: 0 }}>
          <input className="input" placeholder="Buscar nombre, usuario, teléfono…" value={q}
            onChange={(e) => setQ(e.target.value)} style={{ width: '100%', fontSize: '.8rem', padding: '.4rem .6rem' }} />
        </div>
        <div style={{ display: 'flex', gap: '.3rem', padding: '0 .6rem .6rem', borderBottom: '1px solid var(--border)', flexShrink: 0, flexWrap: 'wrap' }}>
          {([
            ['todos', 'Todos', null, '#8b93a9'],
            ['no_leidos', 'No leídos', counts.noLeidos, '#22c55e'],
            ['revisar', 'Revisar', counts.revisar, '#f97316'],
            ['activos', 'Activos', counts.activos, '#8b93a9'],
            ['acreditados', 'Acreditados', counts.acreditados, '#22c55e'],
            ['no_cargo', 'No cargó', counts.no_cargo, '#ef4444'],
            ['archivadas', 'Archivadas', counts.archivadas, '#8b93a9'],
          ] as const).map(([f, label, n, c]) => {
            const on = filter === f;
            return (
              <button key={f} onClick={() => setFilter(f)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '.3rem', padding: '.28rem .55rem', fontSize: '.72rem', fontWeight: on ? 700 : 500, borderRadius: 7, cursor: 'pointer', border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`, background: on ? 'var(--accent-soft)' : 'transparent', color: on ? 'var(--accent)' : 'var(--muted)' }}>
                {label}{n ? <span style={{ fontWeight: 700, color: on ? 'var(--accent)' : c }}>{n}</span> : ''}
              </button>
            );
          })}
        </div>
        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
          {shown.length === 0 && <div className="empty" style={{ padding: '2rem' }}>Sin chats.</div>}
          {shown.map((i) => {
            const si = stepInfo(i.step);
            const selected = sel === i.sessionKey;
            const attn = needsAttention(i);
            const edge = selected ? 'var(--accent)' : attn ? '#e88838' : 'transparent';
            return (
              <button key={i.sessionKey} onClick={() => setSel(i.sessionKey)}
                style={{
                  display: 'block', width: '100%', textAlign: 'left', padding: '.65rem .7rem .65rem calc(.7rem - 3px)',
                  border: 'none', borderBottom: '1px solid var(--border)', borderLeft: `3px solid ${edge}`, cursor: 'pointer',
                  background: selected ? 'rgba(124, 92, 255, 0.05)' : attn ? 'rgba(232,136,56,.07)' : 'transparent',
                  transition: 'background 0.2s ease',
                }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.5rem' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '.35rem', minWidth: 0 }}>
                    {needsReview(i) && <span title="Comprobante por revisar" style={{ width: 7, height: 7, borderRadius: '50%', background: '#e88838', flexShrink: 0 }} />}
                    <strong style={{ fontSize: '.85rem', fontWeight: attn ? 750 : 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: i.unread || selected ? '#fff' : 'inherit' }}>{i.name || i.phone || 'Sin nombre'}</strong>
                    {i.username && <span title="Usuario del portal" style={{ fontSize: '.7rem', fontWeight: 600, color: 'var(--accent)', whiteSpace: 'nowrap' }}>@{i.username}</span>}
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '.45rem', flexShrink: 0 }}>
                    <span style={{ fontSize: '.66rem', color: 'var(--muted-2, #5d6478)' }}>{timeAgo(i.updatedAt)}</span>
                    {i.unread && (
                      <span title="Mensajes sin leer" style={{ width: 18, height: 18, borderRadius: '50%', background: '#e8a050', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '.62rem', fontWeight: 750, boxShadow: '0 0 6px rgba(232,160,80,0.4)' }}>1</span>
                    )}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '.35rem', alignItems: 'center', margin: '.28rem 0' }}>
                  <span style={{ fontSize: '.62rem', fontWeight: 700, color: '#fff', background: si.color, padding: '.05rem .4rem', borderRadius: 5 }}>{si.label}</span>
                  {i.hasComprobante && i.step !== 'done' && i.step !== 'closed' && (
                    <span title="Envió comprobante — requiere revisión" style={{ fontSize: '.6rem', fontWeight: 700, color: '#4ade80' }}>🧾 comprob.</span>
                  )}
                  {i.blocked && <span title="Bloqueado" style={{ fontSize: '.6rem', fontWeight: 700, color: '#fff', background: '#b91c1c', padding: '.05rem .4rem', borderRadius: 5 }}>🚫 Bloqueado</span>}
                  {i.campaign && <span style={{ fontSize: '.62rem', color: 'var(--muted-2,#5d6478)' }}>{i.campaign}</span>}
                </div>
                <div style={{ fontSize: '.72rem', color: i.unread ? 'var(--text)' : 'var(--muted,#8b93a9)', fontWeight: i.unread ? 600 : 400, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {i.lastFrom === 'user' ? '👤 ' : ''}{i.lastText}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* BARRA DIVISORA arrastrable */}
      <div onMouseDown={startDrag} onDoubleClick={resetDrag} title="Arrastrar para ajustar · doble clic para restablecer"
        style={{ cursor: 'col-resize', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: 3, height: 46, borderRadius: 3, background: 'var(--border-2)', transition: 'background .15s' }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--accent)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--border-2)')} />
      </div>

      {/* DETALLE */}
      <div className="card" style={{ padding: 0, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
        {!detail ? (
          <div className="empty" style={{ padding: '3rem', margin: 'auto' }}>Elegí un chat para ver la conversación.</div>
        ) : (
          <>
            <div style={{ padding: '.8rem 1rem', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
              {/* IZQUIERDA: icono, nombre + selector de estado, y campaña */}
              <div style={{ display: 'flex', gap: '.7rem', minWidth: 0 }}>
                <div style={{ width: 42, height: 42, borderRadius: '50%', background: 'var(--card-3)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', flexShrink: 0 }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '.25rem', minWidth: 0, justifyContent: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', flexWrap: 'wrap' }}>
                    <strong style={{ fontSize: '1.05rem', whiteSpace: 'nowrap' }}>{detail.name || detail.phone}</strong>
                    {detail.username && <span title="Usuario del portal" style={{ fontSize: '.78rem', fontWeight: 700, color: 'var(--accent,#7c5cff)', whiteSpace: 'nowrap', background: 'rgba(124, 92, 255, 0.1)', padding: '0.1rem 0.4rem', borderRadius: 4 }}>@{detail.username}</span>}
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
                  {/* Contexto de Campaña / Bono */}
                  {(() => {
                    const c = items.find(i => i.sessionKey === sel)?.campaign;
                    return (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', fontSize: '.68rem', marginTop: 1 }}>
                        <span style={{ color: '#e8a050', fontWeight: 750, textTransform: 'uppercase', letterSpacing: '.05em' }}>Livechat</span>
                        {c && (
                          <>
                            <span style={{ color: 'var(--border-2)' }}>|</span>
                            <span style={{ color: 'var(--muted)', display: 'inline-flex', alignItems: 'center', gap: '.3rem' }}>
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.6 }}><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
                              {c}
                            </span>
                          </>
                        )}
                      </div>
                    );
                  })()}
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
                {(() => {
                  const blk = items.find((i) => i.sessionKey === sel)?.blocked;
                  return (
                    <button className="tt tt--down tt--right" data-tt={blk ? 'Podrá volver a escribir' : 'No podrá seguir en el chat; se archiva'} disabled={busy}
                      onClick={() => act(blk ? 'unblock' : 'block')}
                      style={{ marginLeft: '.3rem', background: blk ? '#ef4444' : 'transparent', border: `1px solid ${blk ? '#ef4444' : '#b91c1c'}`, color: blk ? '#fff' : '#f87171', borderRadius: 6, cursor: 'pointer', fontSize: '.7rem', fontWeight: 600, padding: '.1rem .45rem' }}>
                      {blk ? '🔓 Desbloquear' : '🚫 Bloquear'}
                    </button>
                  );
                })()}
              </div>
            </div>

            <div ref={bodyRef}
              onScroll={(e) => { const el = e.currentTarget; atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}
              style={{ flex: 1, overflowY: 'auto', padding: '1.1rem 1.2rem', display: 'flex', flexDirection: 'column', gap: '.7rem', minHeight: 0, backgroundColor: 'var(--bg, rgba(0,0,0,.18))', backgroundImage: 'radial-gradient(circle, rgba(124, 92, 255, 0.15) 1px, transparent 1px)', backgroundSize: '24px 24px' }}>
              {detail.messages.map((m, idx) => {
                // Vista de operador: el LEAD (cliente) va a la izquierda, NOSOTROS
                // (bot/operador) a la derecha — estilo Black Dragon.
                const mine = m.from === 'bot';
                // Distinguimos automático (BOT) de lo enviado por el operador desde el panel.
                const who = mine ? (m.op ? 'Operador' : 'Bot') : (detail.name || detail.phone || 'Cliente');
                const accent = mine && m.op ? 'var(--accent, #7c5cff)' : mine ? 'var(--accent)' : 'var(--muted,#8b93a3)';
                return (
                  <div key={idx} style={{ display: 'flex', flexDirection: 'column', alignItems: mine ? 'flex-end' : 'flex-start', maxWidth: '74%', alignSelf: mine ? 'flex-end' : 'flex-start' }}>
                    <div style={{ fontSize: '.66rem', fontWeight: 700, letterSpacing: '.02em', color: mine ? accent : 'var(--muted,#8b93a3)', margin: mine ? '0 .35rem .18rem 0' : '0 0 .18rem .35rem', textTransform: 'uppercase' }}>
                      {who} · {fmtTime(m.at)}
                    </div>
                    <div style={{
                      padding: m.image ? '.4rem' : '.6rem .8rem', borderRadius: 16, fontSize: '.9rem', lineHeight: 1.45, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                      boxShadow: 'none',
                      background: mine ? 'var(--card-2)' : 'var(--card-3)',
                      color: 'var(--text)',
                      border: mine ? `1px solid rgba(124, 92, 255, 0.45)` : '1px solid var(--border)',
                      borderBottomRightRadius: mine ? 4 : 16,
                      borderBottomLeftRadius: mine ? 16 : 4,
                    }}>
                      {m.image ? (
                        mine ? (
                          // Imagen de referencia del bot/operador (ej. portal). Si el
                          // archivo falta, se oculta (igual que en el chat del cliente)
                          // para no mostrar un ícono roto que parece un comprobante.
                          <img src={m.image} alt="" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} style={{ maxWidth: 150, maxHeight: 150, borderRadius: 10, display: 'block', objectFit: 'cover' }} />
                        ) : (
                          <a href={m.image} target="_blank" rel="noreferrer" title="Abrir imagen completa"><img src={m.image} alt="comprobante" style={{ maxWidth: 150, maxHeight: 150, borderRadius: 10, display: 'block', objectFit: 'cover', cursor: 'zoom-in' }} /></a>
                        )
                      ) : m.text}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* ACCIONES */}
            <div style={{ borderTop: '1px solid var(--border)', padding: '.7rem .9rem', display: 'flex', flexDirection: 'column', gap: '.5rem', background: 'var(--bg-2, rgba(255,255,255,.012))', flexShrink: 0 }}>
              {(() => {
                const cur = items.find((i) => i.sessionKey === sel);
                const isArch = cur?.archived;
                return (
                  <>
                    <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
                      <span style={{ fontSize: '.6rem', fontWeight: 700, color: 'var(--muted-2,#5d6478)', textTransform: 'uppercase', letterSpacing: '.04em', marginRight: '.15rem' }}>Comprob.</span>
                      <button className="tt" data-tt="Comprobante válido → acredita y pasa a Cargo$ (dispara la conversión a Meta)" disabled={busy} onClick={() => act('approve')} style={abtn('#16a34a', true)}>✅ Aprobar</button>
                      <button className="tt" data-tt="En revisión — le avisa que estamos validando" disabled={busy} onClick={() => act('pending')} style={abtn()}>⏳ Pendiente</button>
                      <button className="tt" data-tt="Comprobante ilegible/incompleto — le pide reenviarlo" disabled={busy} onClick={() => act('reject')} style={abtn('#ef4444')}>⚠️ Erróneo</button>
                      <button className="tt" data-tt="No depositó — lo pasa a No Cargo (sale de atención)" disabled={busy} onClick={() => act('set_step', undefined, 'no_cargo')} style={abtn('#ef4444')}>🚫 No cargó</button>
                      <span style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 .1rem' }} />
                      <button className="tt" data-tt="Le pasa el WhatsApp de soporte (walink)" disabled={busy} onClick={() => act('support')} style={abtn()}>🙋 Soporte</button>
                      <button className="tt" data-tt="Le manda cómo cargar saldo" disabled={busy} onClick={() => act('deposit')} style={abtn()}>💰 Cargar</button>
                      <button className="tt" data-tt="Le manda cómo retirar" disabled={busy} onClick={() => act('withdraw')} style={abtn()}>💸 Retirar</button>
                      <button className="tt" data-tt="Le reenvía usuario y contraseña" disabled={busy} onClick={() => act('forgot_user')} style={abtn()}>🔐 Datos</button>
                      <button className="tt" data-tt={isArch ? 'Volver a la bandeja' : 'Sacar de la bandeja; vuelve solo si el cliente escribe'} disabled={busy} onClick={() => act(isArch ? 'unarchive' : 'archive')} style={abtn()}>{isArch ? '📤 Desarch.' : '🗂 Archivar'}</button>
                    </div>
                  </>
                );
              })()}
              <div style={{ display: 'flex', gap: '.4rem', marginTop: '.1rem' }}>
                <input className="input" placeholder="Mensaje libre al cliente…" value={custom}
                  onChange={(e) => setCustom(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && custom.trim()) { act('custom', custom); setCustom(''); } }}
                  style={{ flex: 1, padding: '.5rem .7rem', fontSize: '.85rem' }} />
                <button disabled={busy || !custom.trim()} onClick={() => { act('custom', custom); setCustom(''); }} style={abtn('var(--accent)', true)}>Enviar</button>
              </div>
            </div>
          </>
        )}
      </div>

      {exportOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
          onClick={() => !exportBusy && setExportOpen(false)}>
          <div className="card" style={{ width: 'min(420px, 100%)', padding: '1.1rem 1.2rem', display: 'flex', flexDirection: 'column', gap: '.75rem' }}
            onClick={(e) => e.stopPropagation()}>
            <div style={{ fontWeight: 700, fontSize: '1rem' }}>Exportar chats a CSV</div>
            <p style={{ fontSize: '.78rem', color: 'var(--muted)', margin: 0, lineHeight: 1.45 }}>
              Cruza con bases externas: usuario y teléfono en columnas separadas (teléfono sin «+», formato 549…).
              Sin filtro de estado = todos los registros del rango.
            </p>
            <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap' }}>
              <div className="field" style={{ flex: '1 1 120px' }}>
                <label style={{ fontSize: '.72rem', color: 'var(--muted-2)' }}>Desde (creado)</label>
                <input className="input" type="date" value={exportFrom} onChange={(e) => setExportFrom(e.target.value)} style={{ fontSize: '.8rem' }} />
              </div>
              <div className="field" style={{ flex: '1 1 120px' }}>
                <label style={{ fontSize: '.72rem', color: 'var(--muted-2)' }}>Hasta (creado)</label>
                <input className="input" type="date" value={exportTo} onChange={(e) => setExportTo(e.target.value)} style={{ fontSize: '.8rem' }} />
              </div>
            </div>
            <div>
              <div style={{ fontSize: '.72rem', color: 'var(--muted-2)', marginBottom: '.35rem' }}>Estado (opcional — vacío = todos)</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.35rem' }}>
                {EXPORT_STEPS.map((st) => {
                  const on = exportSteps.includes(st);
                  const si = stepInfo(st);
                  return (
                    <button key={st} type="button" onClick={() => setExportSteps((p) => on ? p.filter((x) => x !== st) : [...p, st])}
                      style={{ padding: '.22rem .5rem', fontSize: '.7rem', fontWeight: on ? 700 : 500, borderRadius: 6, cursor: 'pointer',
                        border: `1px solid ${on ? si.color : 'var(--border)'}`, background: on ? `${si.color}22` : 'transparent', color: on ? si.color : 'var(--muted)' }}>
                      {si.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div style={{ display: 'flex', gap: '.5rem', justifyContent: 'flex-end', marginTop: '.25rem' }}>
              <button className="btn btn--ghost" disabled={exportBusy} onClick={() => setExportOpen(false)}>Cancelar</button>
              <button disabled={exportBusy} onClick={runExport} style={abtn('#16a34a', true)}>{exportBusy ? 'Exportando…' : '⬇ Descargar CSV'}</button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: '#111827', color: '#fff', padding: '.6rem 1rem', borderRadius: 10, fontSize: '.85rem', zIndex: 50 }}>{toast}</div>
      )}
    </div>
    </>
  );
}

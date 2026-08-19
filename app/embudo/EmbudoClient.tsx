'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

type Item = {
  sessionKey: string; phone: string | null; name: string | null; username: string | null;
  step: string | null; campaign: string | null; hasComprobante: boolean; unread: boolean;
  archived: boolean; updatedAt: string | null;
};
type Stat = { step: string | null; createdAt: string | null };

// Etapas del embudo (mismos nombres que Kommo), en orden.
const STAGES: Array<{ key: string; label: string; color: string }> = [
  { key: 'welcome', label: 'Pidió Usuario', color: '#64748b' },
  { key: 'credenciales', label: 'Usuario Creado', color: '#0ea5e9' },
  { key: 'comprobante', label: 'Pidió CBU', color: '#3b82f6' },
  { key: 'app_onboarding', label: 'Instalando app', color: '#f59e0b' },
  { key: 'validando', label: 'Revisar imagen', color: '#f97316' },
  { key: 'done', label: 'Cargo$', color: '#22c55e' },
  { key: 'no_cargo', label: 'No Cargo', color: '#ef4444' },
];
// 'cbu' comparte etapa con 'comprobante' (Pidió CBU / esperando pago).
const stageOf = (step: string | null) => (step === 'cbu' ? 'comprobante' : step);

const timeAgo = (iso: string | null) => {
  if (!iso) return '';
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'recién';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
};

export function EmbudoClient() {
  const [items, setItems] = useState<Item[]>([]);
  const [stats, setStats] = useState<Stat[]>([]);
  const [open, setOpen] = useState<Record<string, boolean>>({ validando: true, comprobante: true });

  const load = useCallback(async () => {
    const r = await fetch('/api/panel/chats').then((x) => x.json()).catch(() => null);
    if (r?.ok) { setItems(r.items); setStats(r.stats ?? []); }
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 10000); return () => clearInterval(t); }, [load]);

  const total = stats.filter((s) => STAGES.some((st) => st.key === stageOf(s.step))).length || 1;
  const countOf = (key: string) => stats.filter((s) => stageOf(s.step) === key).length;
  const itemsOf = (key: string) => items.filter((i) => !i.archived && stageOf(i.step) === key);

  // Métricas tangibles.
  const done = countOf('done');
  const noCargo = countOf('no_cargo');
  const enProceso = ['welcome', 'credenciales', 'comprobante', 'app_onboarding', 'validando'].reduce((a, k) => a + countOf(k), 0);
  const decididos = done + noCargo; // los que llegaron a un resultado
  const conv = decididos ? Math.round((100 * done) / decididos) : 0;
  const maxCount = Math.max(1, ...STAGES.map((st) => countOf(st.key)));

  const Metric = ({ label, value, color }: { label: string; value: string | number; color?: string }) => (
    <div style={{ flex: '1 1 0', minWidth: 90, padding: '.7rem .8rem', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--bg-2, rgba(255,255,255,.015))' }}>
      <div style={{ fontSize: '1.4rem', fontWeight: 800, color: color ?? 'var(--text)', lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: '.66rem', color: 'var(--muted-2,#5d6478)', marginTop: '.3rem', textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</div>
    </div>
  );

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: '1rem', alignItems: 'start' }}>
    {/* IZQUIERDA: acordeón por etapa */}
    <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
      {STAGES.map((st) => {
        const n = countOf(st.key);
        const pct = Math.round((100 * n) / total);
        const list = itemsOf(st.key);
        const isOpen = open[st.key];
        return (
          <div key={st.key} className="card" style={{ padding: 0, overflow: 'hidden', borderLeft: `3px solid ${st.color}` }}>
            {/* Cabecera de etapa */}
            <button onClick={() => setOpen((o) => ({ ...o, [st.key]: !o[st.key] }))}
              style={{ display: 'flex', alignItems: 'center', gap: '.7rem', width: '100%', padding: '.75rem 1rem', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
              <span aria-hidden style={{ color: 'var(--muted)', fontSize: '.75rem', transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}>▶</span>
              <span style={{ width: 9, height: 9, borderRadius: '50%', background: st.color, flexShrink: 0 }} />
              <strong style={{ fontSize: '.95rem' }}>{st.label}</strong>
              <span style={{ fontSize: '1.05rem', fontWeight: 800, color: st.color }}>{n}</span>
              <span style={{ fontSize: '.72rem', color: 'var(--muted-2,#5d6478)' }}>{pct}% del embudo</span>
              {/* barra de proporción */}
              <span style={{ marginLeft: 'auto', width: 140, height: 6, borderRadius: 4, background: 'var(--border)', overflow: 'hidden' }}>
                <span style={{ display: 'block', height: '100%', width: `${pct}%`, background: st.color }} />
              </span>
            </button>
            {/* Lista de chats de la etapa (recientes cargados) */}
            {isOpen && (
              <div style={{ borderTop: '1px solid var(--border)', maxHeight: 320, overflowY: 'auto' }}>
                {list.length === 0 && <div className="empty" style={{ padding: '1rem', fontSize: '.82rem' }}>Sin chats recientes en esta etapa.</div>}
                {list.map((i) => (
                  <Link key={i.sessionKey} href={`/chats?s=${i.sessionKey}`}
                    style={{ display: 'flex', alignItems: 'center', gap: '.6rem', padding: '.5rem 1rem .5rem 2rem', borderBottom: '1px solid var(--border)', textDecoration: 'none', color: 'var(--text)' }}>
                    <strong style={{ fontSize: '.82rem', whiteSpace: 'nowrap' }}>{i.name || i.phone || 'Sin nombre'}</strong>
                    {i.username && <span style={{ fontSize: '.7rem', color: 'var(--accent)' }}>@{i.username}</span>}
                    {i.hasComprobante && <span title="Comprobante" style={{ fontSize: '.68rem', color: '#4ade80' }}>🧾</span>}
                    {i.unread && <span title="Sin leer" style={{ width: 7, height: 7, borderRadius: '50%', background: '#e88838' }} />}
                    {i.campaign && <span style={{ fontSize: '.68rem', color: 'var(--muted-2,#5d6478)' }}>{i.campaign}</span>}
                    <span style={{ marginLeft: 'auto', fontSize: '.68rem', color: 'var(--muted-2,#5d6478)' }}>{timeAgo(i.updatedAt)}</span>
                  </Link>
                ))}
                {n > list.length && (
                  <div style={{ padding: '.5rem 1rem', fontSize: '.72rem', color: 'var(--muted-2,#5d6478)' }}>… y {n - list.length} más (mostrando los recientes)</div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>

    {/* DERECHA: resumen + gráfico */}
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', position: 'sticky', top: '1rem' }}>
      <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap' }}>
        <Metric label="Conversión" value={`${conv}%`} color="var(--accent,#7c6cf5)" />
        <Metric label="Acreditados" value={done} color="#22c55e" />
        <Metric label="No cargó" value={noCargo} color="#ef4444" />
        <Metric label="En proceso" value={enProceso} color="#3b82f6" />
      </div>

      <div className="card" style={{ padding: '1rem 1.1rem' }}>
        <div style={{ fontSize: '.72rem', fontWeight: 700, color: 'var(--muted,#8b93a9)', textTransform: 'uppercase', letterSpacing: '.03em', marginBottom: '.85rem' }}>Distribución por etapa</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '.6rem' }}>
          {STAGES.map((st) => {
            const n = countOf(st.key);
            const w = Math.round((100 * n) / maxCount);
            return (
              <div key={st.key} style={{ display: 'flex', alignItems: 'center', gap: '.7rem' }}>
                <span style={{ width: 118, fontSize: '.74rem', color: 'var(--muted,#8b93a9)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flexShrink: 0 }}>{st.label}</span>
                <span style={{ flex: 1, height: 14, borderRadius: 4, background: 'var(--border)', overflow: 'hidden' }}>
                  <span style={{ display: 'block', height: '100%', width: `${Math.max(n ? 4 : 0, w)}%`, background: st.color, transition: 'width .3s' }} />
                </span>
                <strong style={{ width: 38, textAlign: 'right', fontSize: '.82rem', color: st.color }}>{n}</strong>
              </div>
            );
          })}
        </div>
        <div style={{ marginTop: '1rem', paddingTop: '.8rem', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', fontSize: '.78rem', color: 'var(--muted,#8b93a9)' }}>
          <span>Total en embudo</span>
          <strong style={{ color: 'var(--text)' }}>{total}</strong>
        </div>
        <div style={{ marginTop: '.5rem', fontSize: '.72rem', color: 'var(--muted-2,#5d6478)', lineHeight: 1.4 }}>
          Conversión = Acreditados ÷ (Acreditados + No cargó). Hoy: {done} de {decididos} que llegaron a un resultado.
        </div>
      </div>
    </div>
    </div>
  );
}

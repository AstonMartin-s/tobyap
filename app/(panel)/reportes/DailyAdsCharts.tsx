'use client';

export type DailyChartPoint = {
  day: string;
  gasto: number;
  costPerCarga: number;
  cargas: number;
};

const money = (n: number) => `$${n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDay = (day: string) => {
  const [, m, d] = day.split('-');
  return `${d}/${m}`;
};

function LineChart({
  title,
  data,
  valueKey,
  format,
  color,
}: {
  title: string;
  data: DailyChartPoint[];
  valueKey: keyof Pick<DailyChartPoint, 'gasto' | 'costPerCarga' | 'cargas'>;
  format: (n: number) => string;
  color: string;
}) {
  const W = 280;
  const H = 120;
  const pad = { l: 8, r: 8, t: 22, b: 26 };
  const values = data.map((d) => d[valueKey]);
  const max = Math.max(...values, 1);
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;
  const n = data.length;

  const pts = data.map((d, i) => {
    const x = pad.l + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
    const y = pad.t + innerH - (d[valueKey] / max) * innerH;
    return { x, y, d };
  });

  const polyline = pts.map((p) => `${p.x},${p.y}`).join(' ');

  return (
    <div className="daily-chart">
      <div className="daily-chart__head">
        <span className="daily-chart__title">{title}</span>
        {data.length > 0 && (
          <span className="daily-chart__last" style={{ color }}>
            {format(data[data.length - 1][valueKey])}
          </span>
        )}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="daily-chart__svg" aria-hidden>
        {[0.25, 0.5, 0.75, 1].map((t) => (
          <line
            key={t}
            x1={pad.l}
            x2={W - pad.r}
            y1={pad.t + innerH * (1 - t)}
            y2={pad.t + innerH * (1 - t)}
            className="daily-chart__grid"
          />
        ))}
        {pts.length > 1 && (
          <polyline points={polyline} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        )}
        {pts.map((p) => (
          <circle key={p.d.day} cx={p.x} cy={p.y} r="4" fill={color} />
        ))}
        {pts.map((p) => (
          <text key={`lbl-${p.d.day}`} x={p.x} y={H - 6} textAnchor="middle" className="daily-chart__axis">
            {fmtDay(p.d.day)}
          </text>
        ))}
      </svg>
    </div>
  );
}

export function DailyAdsCharts({ data }: { data: DailyChartPoint[] }) {
  if (!data.length) {
    return <p className="empty" style={{ margin: 0 }}>Sin datos para graficar.</p>;
  }

  return (
    <div className="daily-charts">
      <p className="daily-charts__hint">Últimos 3 días (zona Argentina)</p>
      <div className="daily-charts__grid">
        <LineChart title="Gasto" data={data} valueKey="gasto" format={money} color="var(--blue)" />
        <LineChart title="Costo por carga" data={data} valueKey="costPerCarga" format={money} color="var(--accent)" />
        <LineChart title="Cargas" data={data} valueKey="cargas" format={(n) => String(n)} color="var(--success)" />
      </div>
    </div>
  );
}

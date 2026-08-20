import type { DailyRow } from '@/lib/reports';

const money = (n: number) => `$${n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function DailyAdsTable({
  daily,
  tot,
  convTot,
  saldoFinal,
}: {
  daily: DailyRow[];
  tot: { chats: number; cargas: number; gasto: number; recarga: number };
  convTot: number;
  saldoFinal: number;
}) {
  if (daily.length === 0) {
    return <div className="empty">Sin eventos ni cargas en el período seleccionado.</div>;
  }

  return (
    <table className="table">
      <thead>
        <tr>
          <th>Fecha</th>
          <th className="num">Chats</th>
          <th className="num">$/Chat</th>
          <th className="num">Cargas</th>
          <th className="num">Conv.</th>
          <th className="num">$/Carga</th>
          <th className="num">Gasto</th>
          <th className="num">Recarga</th>
          <th className="num">Saldo</th>
        </tr>
      </thead>
      <tbody>
        {daily.map((r) => (
          <tr key={r.day}>
            <td style={{ whiteSpace: 'nowrap' }}>{r.day}</td>
            <td className="num">{r.chats}</td>
            <td className="num">{money(r.costPerChat)}</td>
            <td className="num">{r.cargas}</td>
            <td className="num" style={{ color: 'var(--accent)' }}>{r.conversion}%</td>
            <td className="num">{money(r.costPerCarga)}</td>
            <td className="num">{money(r.gasto)}</td>
            <td className="num">{money(r.recarga)}</td>
            <td className="num" style={{ fontWeight: 600, color: r.saldo >= 0 ? 'var(--text)' : 'var(--danger)' }}>
              {money(r.saldo)}
            </td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr style={{ borderTop: '2px solid var(--border-2)', fontWeight: 700 }}>
          <td>Σ Acumulado</td>
          <td className="num">{tot.chats}</td>
          <td className="num">{money(tot.chats ? tot.gasto / tot.chats : 0)}</td>
          <td className="num">{tot.cargas}</td>
          <td className="num" style={{ color: 'var(--accent)' }}>{convTot}%</td>
          <td className="num">{money(tot.cargas ? tot.gasto / tot.cargas : 0)}</td>
          <td className="num">{money(tot.gasto)}</td>
          <td className="num">{money(tot.recarga)}</td>
          <td className="num" style={{ color: saldoFinal >= 0 ? 'var(--accent)' : 'var(--danger)' }}>{money(saldoFinal)}</td>
        </tr>
      </tfoot>
    </table>
  );
}

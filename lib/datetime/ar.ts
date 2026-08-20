/** Horarios del panel/chat siempre en Argentina (independiente del navegador del operador). */
export const TZ_AR = 'America/Argentina/Buenos_Aires';

export function fmtChatTime(at: number): string {
  const d = new Date(at < 1e12 ? at * 1000 : at);
  const now = new Date();
  const sameDay = d.toLocaleDateString('es-AR', { timeZone: TZ_AR }) === now.toLocaleDateString('es-AR', { timeZone: TZ_AR });
  const hh = d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', timeZone: TZ_AR });
  return sameDay ? hh : `${d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', timeZone: TZ_AR })} ${hh}`;
}

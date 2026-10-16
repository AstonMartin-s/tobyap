// Panel de operación de SenderIO, embebido en el admin de Tracker.
// La auth Basic de Sender no viaja en el navegador: el iframe apunta al modo
// embed, y Sender limita frame-ancestors al origen del panel.

export const SENDER_ORIGIN = 'https://senderio-production.up.railway.app';

export const SENDER_VIEWS = [
  { id: 'overview', label: 'Overview' },
  { id: 'bms', label: 'Por BM' },
  { id: 'plantillas', label: 'Plantillas' },
  { id: 'funnel', label: 'Funnel & KPIs' },
  { id: 'log', label: 'Log en vivo' },
  { id: 'clientes', label: 'Clientes' },
  { id: 'verificador', label: 'Verificador WA' },
] as const;

export type SenderViewId = (typeof SENDER_VIEWS)[number]['id'];

export function senderView(id: string) {
  return SENDER_VIEWS.find((v) => v.id === id) ?? null;
}

export function senderEmbedUrl(id: SenderViewId): string {
  return `${SENDER_ORIGIN}/embed/${id}`;
}

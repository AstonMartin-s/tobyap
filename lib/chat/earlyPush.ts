// Pilot: pedir el permiso de notificaciones al tocar Comenzar (gesto).
// Sin deps de server para que el widget lo importe.
// King / bblack / paradise no muestran copy extra en el form.

export const EARLY_PUSH_SLUGS = [
  'elganador',
  'goldenc',
  'luck',
  'piliking',
  'kingplay', // KingCBA
] as const;

export const PUSH_STATUSES = ['granted', 'denied', 'dismissed', 'unsupported', 'ios_pwa'] as const;
export type PushStatus = (typeof PUSH_STATUSES)[number];

export function wantsEarlyPush(slug: string): boolean {
  return (EARLY_PUSH_SLUGS as readonly string[]).includes(slug);
}

export function normalizePushStatus(raw: unknown): PushStatus | null {
  if (typeof raw !== 'string') return null;
  return (PUSH_STATUSES as readonly string[]).includes(raw) ? (raw as PushStatus) : null;
}

export function isPushGranted(data: Record<string, unknown> | null | undefined): boolean {
  if (!data) return false;
  if (data.pushStatus === 'granted') return true;
  if (data.appNotif === true) return true;
  if (data.pushSub && typeof data.pushSub === 'object') return true;
  return false;
}

export function pushDataFromStatus(status: PushStatus): Record<string, unknown> {
  return {
    pushStatus: status,
    pushAskedAt: Date.now(),
    ...(status === 'granted' ? { appNotif: true } : {}),
  };
}

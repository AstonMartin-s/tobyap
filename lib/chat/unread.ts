/** Merge de flags de no-leído con contador incremental (panel). */
export function unreadDataMerge(prev: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const was = prev?.unread === true;
  const prevN = typeof prev?.unreadCount === 'number' ? prev.unreadCount : 0;
  return { unread: true, unreadCount: was ? prevN + 1 : 1, archived: false };
}

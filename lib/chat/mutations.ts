import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { applyUnreadIncrement } from '@/lib/chat/unread';

// Escrituras ATÓMICAS sobre chat_sessions. El patrón anterior (leer la fila en JS,
// modificar el array/objeto y reescribirlo entero) sufre lost-update: si dos
// escritores tocan la misma sesión casi a la vez (operario + supervisor, o el
// cliente + el scheduler de recordatorios), el último pisa al otro y se pierde un
// mensaje o un flag. Acá concatenamos/mergeamos a nivel Postgres (`||`), que
// serializa el UPDATE sobre la fila bajo lock — mismo criterio que acreditarChat.

type ChatMsg = { from: 'bot' | 'user'; text?: string; image?: string; at: number; op?: boolean; n?: boolean };

interface AppendOpts {
  step?: string;
  /** Merge shallow sobre `data` (setea/actualiza claves sin pisar el resto). */
  dataMerge?: Record<string, unknown>;
  /** Claves a eliminar de `data` (ej. limpiar el base64 del comprobante). */
  dataRemove?: string[];
  /** Anexa elementos al final de un array jsonb en `data` (crea la clave si falta). */
  dataAppend?: Record<string, unknown[]>;
  /** Marca no leído e incrementa unreadCount en Postgres (sin race). */
  markUnread?: boolean;
}

function dataExpr(merge?: Record<string, unknown>, remove?: string[], markUnread?: boolean, append?: Record<string, unknown[]>) {
  let expr = sql`coalesce(data, '{}'::jsonb)`;
  if (merge && Object.keys(merge).length) {
    expr = sql`${expr} || ${JSON.stringify(merge)}::jsonb`;
  }
  for (const k of remove ?? []) {
    expr = sql`${expr} - ${k}`;
  }
  for (const [k, arr] of Object.entries(append ?? {})) {
    if (!arr.length) continue;
    // jsonb_set + coalesce: si la clave no existe arranca de '[]' y concatena.
    expr = sql`jsonb_set(${expr}, array[${k}]::text[], coalesce(${expr} -> ${k}, '[]'::jsonb) || ${JSON.stringify(arr)}::jsonb, true)`;
  }
  if (markUnread) expr = applyUnreadIncrement(expr);
  return expr;
}

/** Agrega mensajes al final (atómico) y, opcionalmente, mueve step y mergea data. */
export async function appendChatMessages(
  sessionId: string,
  msgs: ChatMsg[],
  opts: AppendOpts = {},
): Promise<void> {
  const parts = [
    sql`messages = coalesce(messages, '[]'::jsonb) || ${JSON.stringify(msgs)}::jsonb`,
    sql`updated_at = now()`,
  ];
  if (opts.step) parts.push(sql`step = ${opts.step}`);
  const hasAppend = !!opts.dataAppend && Object.keys(opts.dataAppend).length > 0;
  if (opts.dataMerge || opts.dataRemove?.length || opts.markUnread || hasAppend) {
    parts.push(sql`data = ${dataExpr(opts.dataMerge, opts.dataRemove, opts.markUnread, opts.dataAppend)}`);
  }
  await db.execute(sql`UPDATE chat_sessions SET ${sql.join(parts, sql`, `)} WHERE id = ${sessionId}`);
}

/** Mergea claves en `data` sin tocar mensajes (atómico). */
export async function mergeChatData(
  sessionId: string,
  merge: Record<string, unknown>,
  remove?: string[],
  opts?: { touchUpdatedAt?: boolean },
): Promise<void> {
  const parts = [sql`data = ${dataExpr(merge, remove)}`];
  if (opts?.touchUpdatedAt !== false) parts.push(sql`updated_at = now()`);
  await db.execute(sql`UPDATE chat_sessions SET ${sql.join(parts, sql`, `)} WHERE id = ${sessionId}`);
}

import { sql, type SQL } from 'drizzle-orm';

/** Incrementa unreadCount atómicamente sobre una expresión jsonb `data`. */
export function applyUnreadIncrement(expr: SQL): SQL {
  return sql`${expr} || jsonb_build_object(
    'unread', true,
    'archived', false,
    'unreadCount',
    coalesce((${expr} ->> 'unreadCount')::int, CASE WHEN (${expr} ->> 'unread') = 'true' THEN 1 ELSE 0 END) + 1
  )`;
}

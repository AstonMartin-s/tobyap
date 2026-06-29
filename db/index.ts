import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL no está definida');
}

// Cliente único reutilizable (evita múltiples pools en dev/hot-reload).
const globalForDb = globalThis as unknown as { _pg?: ReturnType<typeof postgres> };
// max acotado: en picos de ads varios webhooks concurrentes no agotan el límite
// de conexiones del Postgres del plan. idle_timeout libera conexiones ociosas.
const client =
  globalForDb._pg ?? postgres(connectionString, { prepare: false, max: 8, idle_timeout: 20 });
if (process.env.NODE_ENV !== 'production') globalForDb._pg = client;

export const db = drizzle(client, { schema });
export { schema };
